(function () {
    var PROMPT_IDS = [
        "txt2img_prompt",
        "txt2img_neg_prompt",
        "img2img_prompt",
        "img2img_neg_prompt",
        "hires_prompt",
        "hires_neg_prompt",
    ];
    var MAX_TAGS = 200;
    var MAX_TAG_LEN = 80;
    var DEBOUNCE_MS = 300;

    var dragFrom = null;
    var hoverChip = null;
    var fields = [];

    function getApp() {
        if (typeof window.gradioApp === "function") {
            var app = window.gradioApp();
            if (app && typeof app.getElementById === "function") {
                return app;
            }
        }
        return document;
    }

    function fireInput(target) {
        if (typeof window.updateInput === "function") {
            window.updateInput(target);
            return;
        }
        var e = new Event("input", { bubbles: true });
        Object.defineProperty(e, "target", { value: target });
        target.dispatchEvent(e);
    }

    function markSynced(textarea, value) {
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].textarea === textarea) fields[i].lastValue = value;
        }
    }

    // External changes (e.g. "use prompt from preview image", other extensions)
    // often set textarea.value without firing any input event. Watch the real
    // value and re-render whenever it drifts from what we last rendered.
    function pollExternalChanges() {
        if (dragFrom !== null) return;
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            if (!f.textarea.isConnected) {
                fields.splice(i, 1);
                i--;
                continue;
            }
            if (f.textarea.value !== f.lastValue) {
                f.lastValue = f.textarea.value;
                renderTags(f.textarea, f.container);
            }
        }
    }

    function splitPromptTags(text) {
        var parts = [];
        var stack = [];
        var cur = "";
        var closers = { ")": "(", "]": "[", "}": "{", ">": "<" };
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
                stack.push(ch);
                cur += ch;
            } else if (Object.prototype.hasOwnProperty.call(closers, ch)) {
                if (stack.length > 0 && stack[stack.length - 1] === closers[ch]) {
                    stack.pop();
                }
                cur += ch;
                // A closing ">" that returns to depth 0 ends a network tag
                // (<lora:...>, <embedding:...>, <hypernet:...>). Anything after
                // it on this segment — usually the trigger word, with no comma
                // inserted by LoRA pickers — is a separate token, so cut here
                // just like a comma. If a comma follows directly, let the comma
                // do the splitting instead, or we get an empty segment.
                if (ch === ">" && stack.length === 0 && i + 1 < text.length && text[i + 1] !== ",") {
                    parts.push(cur);
                    cur = "";
                }
            } else if (ch === "," && stack.length === 0) {
                parts.push(cur);
                cur = "";
            } else {
                cur += ch;
            }
        }
        parts.push(cur);
        // Post-pass: a standalone all-caps BREAK is always its own chip, even
        // with no commas around it — "a BREAK b", "a\nBREAK\nb" and "a,BREAK,b"
        // all split into [a, BREAK, b]. BREAKFAST or MYBREAK don't match.
        // Purely empty gap pieces are dropped; segments without any BREAK are
        // kept untouched (so "a,,b" still keeps its "·" chip).
        var result = [];
        var re = /\bBREAK\b/g;
        for (var p = 0; p < parts.length; p++) {
            var seg = parts[p];
            if (seg.trim() === "") {
                result.push(seg);
                continue;
            }
            var last = 0;
            var foundBreak = false;
            re.lastIndex = 0;
            var m;
            while ((m = re.exec(seg)) !== null) {
                foundBreak = true;
                if (m.index > last && seg.slice(last, m.index).trim() !== "") {
                    result.push(seg.slice(last, m.index));
                }
                result.push("BREAK");
                last = m.index + 5;
            }
            if (!foundBreak) {
                result.push(seg);
            } else if (last < seg.length && seg.slice(last).trim() !== "") {
                result.push(seg.slice(last));
            }
        }
        return result;
    }

    function clampWeight(w) {
        return Math.max(0.01, w);
    }

    function formatWeight(w) {
        w = parseFloat(w.toPrecision(12));
        if (Number.isInteger(w)) return w + ".0";
        return String(w);
    }

    function precisionFor(mode) {
        var opts = window.opts || {};
        if (mode === "angle") {
            return typeof opts.keyedit_precision_extra === "number"
                ? opts.keyedit_precision_extra
                : 0.05;
        }
        return typeof opts.keyedit_precision_attention === "number"
            ? opts.keyedit_precision_attention
            : 0.1;
    }

    // Adjusts the weight of one prompt tag. Returns the new tag text, or null
    // when the tag carries no adjustable weight (e.g. [a:b:c] schedules).
    function adjustTagWeight(tag, dir) {
        var delta;
        if (tag.trim().toUpperCase() === "BREAK") return null;
        var m = tag.match(/^<(.+):([0-9]+(?:\.[0-9]+)?)>$/);
        if (m) {
            delta = precisionFor("angle");
            var loraWeight = clampWeight(parseFloat(m[2]) + delta * dir);
            return "<" + m[1] + ":" + formatWeight(loraWeight) + ">";
        }

        m = tag.match(/^([({])(.+):([0-9]+(?:\.[0-9]+)?)([)}])$/);
        if (m) {
            delta = precisionFor("paren");
            var parenWeight = clampWeight(parseFloat(m[3]) + delta * dir);
            if (parenWeight === 1 && m[1] === "(") {
                return m[2].trim();
            }
            return m[1] + m[2] + ":" + formatWeight(parenWeight) + m[4];
        }

        m = tag.match(/^\(([^()\[\]{}<>]*)\)$/);
        if (m) {
            delta = precisionFor("paren");
            var implicitWeight = clampWeight(1.1 + delta * dir);
            if (implicitWeight === 1) {
                return m[1].trim();
            }
            return "(" + m[1] + ":" + formatWeight(implicitWeight) + ")";
        }

        if (!/[()\[\]{}<>]/.test(tag)) {
            delta = precisionFor("paren");
            var bareWeight = clampWeight(1 + delta * dir);
            if (bareWeight === 1) {
                return tag;
            }
            return "(" + tag + ":" + formatWeight(bareWeight) + ")";
        }

        return null;
    }

    function chipFromEvent(e) {
        return e.target && typeof e.target.closest === "function"
            ? e.target.closest(".taggerator-chip")
            : null;
    }

    function clearHover(container) {
        var old = container.querySelector(".taggerator-chip.drag-over");
        if (old) old.classList.remove("drag-over");
    }

    // Strip weights and surrounding brackets so "(solo:1.2)", "solo" and
    // "<lora:x:0.8>" can be compared for duplicates. Empty text is null.
    function normalizeTagKey(part) {
        var s = part.trim().toLowerCase();
        if (s === "") return null;
        s = s.replace(/:\d+(?:\.\d+)?/g, "");
        s = s.replace(/^[({[<>]+|[)}\]>]+$/g, "");
        return s;
    }

    function isBreakSeparated(parts, keys, key) {
        var first = -1;
        var last = -1;
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] === key) {
                if (first === -1) first = i;
                last = i;
            }
        }
        if (first === -1 || last === first) return false;
        for (var j = first + 1; j < last; j++) {
            if (parts[j].trim().toLowerCase() === "break") return true;
        }
        return false;
    }

    function renderTags(textarea, container) {
        var text = textarea.value;
        var parts = splitPromptTags(text);
        var meaningful = 0;
        for (var p = 0; p < parts.length; p++) {
            if (parts[p].trim() !== "") meaningful++;
        }
        // A prompt ending in a comma (e.g. "1girl, land,") is common style.
        // The empty trailing segment is not a tag — never render a chip for it.
        var lastIdx = parts.length - 1;
        if (lastIdx >= 0 && parts[lastIdx].trim() === "") {
            parts.length = lastIdx;
        }
        container.replaceChildren();
        if (text.trim() === "" || parts.length < 2 || meaningful < 2) {
            container.classList.add("hidden");
            return;
        }
        container.classList.remove("hidden");

        var shown = parts.slice(0, MAX_TAGS);
        var overflow = parts.length - shown.length;
        // Duplicate detection: same normalized tag more than once.
        var keys = [];
        var keyCount = {};
        for (var k = 0; k < shown.length; k++) {
            var keyk = normalizeTagKey(shown[k]);
            keys.push(keyk);
            if (keyk) keyCount[keyk] = (keyCount[keyk] || 0) + 1;
        }
        shown.forEach(function (part, i) {
            var chip = document.createElement("div");
            chip.className = "taggerator-chip";
            chip.draggable = true;
            chip.setAttribute("data-index", String(i));
            var label = part.trim();
            var key = keys[i];
            var isDup = !!(key && keyCount[key] > 1);
            if (isDup) {
                chip.classList.add("duplicate");
                if (isBreakSeparated(shown, keys, key)) {
                    chip.classList.add("dup-break");
                }
            }
            chip.title =
                label === ""
                    ? label
                    : label +
                      (isDup ? "  \u2014 duplicate" : "") +
                      "  (Alt+scroll: weight, Alt+click: delete)";
            if (label === "") {
                chip.textContent = "\u00b7";
                chip.classList.add("empty");
            } else if (label.length > MAX_TAG_LEN) {
                chip.textContent = label.slice(0, MAX_TAG_LEN) + "\u2026";
            } else {
                chip.textContent = label;
            }
            container.appendChild(chip);
        });
        if (overflow > 0) {
            var more = document.createElement("div");
            more.className = "taggerator-chip taggerator-more";
            more.draggable = false;
            more.textContent = "+" + overflow + " more";
            container.appendChild(more);
        }
    }

    // Rebuild the prompt text after an edit. Trailing commas are style, not
    // tags: the empty trailing segment is dropped and the comma is re-appended
    // so the user's formatting habit survives a reorder. mutate() may return
    // false to abort (nothing changed).
    function rebuildPrompt(textarea, container, mutate) {
        var raw = textarea.value;
        var hasTrailingComma = /,[ \t]*$/.test(raw);
        var parts = splitPromptTags(raw).map(function (p) {
            return p.trim();
        });
        while (parts.length && parts[parts.length - 1] === "") {
            parts.pop();
        }
        if (mutate(parts) === false) return;
        var out = parts.join(", ");
        textarea.value = hasTrailingComma ? out + "," : out;
        fireInput(textarea);
        renderTags(textarea, container);
        markSynced(textarea, textarea.value);
    }

    function commitReorder(textarea, container, from, to) {
        if (from === to) return;
        rebuildPrompt(textarea, container, function (parts) {
            var moved = parts.splice(from, 1)[0];
            var target = to - (from < to ? 1 : 0);
            parts.splice(target, 0, moved);
        });
    }

    function setup(boxId) {
        var app = getApp();
        var box = app.getElementById(boxId);
        if (!box) return false;
        var textarea = box.querySelector("label > textarea");
        if (!textarea) return false;
        if (textarea.dataset.taggerator === "1") return true;
        textarea.dataset.taggerator = "1";

        var label = box.querySelector("label");
        var container = document.createElement("div");
        container.className = "taggerator-tags hidden";
        container.setAttribute("data-taggerator-for", boxId);
        label.appendChild(container);

        container.addEventListener("dragstart", function (e) {
            var chip = chipFromEvent(e);
            if (!chip) return;
            dragFrom = Number(chip.dataset.index);
            chip.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(dragFrom));
        });

        container.addEventListener("dragend", function () {
            dragFrom = null;
            clearHover(container);
            var d = container.querySelector(".taggerator-chip.dragging");
            if (d) d.classList.remove("dragging");
        });

        container.addEventListener("dragleave", function (e) {
            if (hoverChip && !container.contains(e.relatedTarget)) {
                hoverChip.classList.remove("drag-over");
                hoverChip = null;
            }
        });

        container.addEventListener("dragover", function (e) {
            if (dragFrom === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            var chip = chipFromEvent(e);
            if (chip === hoverChip) return;
            if (hoverChip) hoverChip.classList.remove("drag-over");
            hoverChip = chip;
            if (hoverChip) hoverChip.classList.add("drag-over");
        });

        container.addEventListener("drop", function (e) {
            if (dragFrom === null) return;
            e.preventDefault();
            var chip = chipFromEvent(e);
            var from = dragFrom;
            var to;
            if (chip) {
                to = Number(chip.dataset.index);
            } else {
                to = splitPromptTags(textarea.value).length;
            }
            dragFrom = null;
            clearHover(container);
            hoverChip = null;
            var d = container.querySelector(".taggerator-chip.dragging");
            if (d) d.classList.remove("dragging");
            commitReorder(textarea, container, from, to);
        });

        container.addEventListener("click", function (e) {
            var chip = chipFromEvent(e);
            if (!chip) return;
            if (e.altKey) {
                deleteChip(chip);
                return;
            }
            if (!e.shiftKey) return;
            var from = Number(chip.dataset.index);
            commitReorder(textarea, container, from, from - 1);
        });

        function deleteChip(chip) {
            if (dragFrom !== null) return;
            var from = Number(chip.dataset.index);
            rebuildPrompt(textarea, container, function (parts) {
                if (parts[from] === undefined) return false;
                parts.splice(from, 1);
            });
        }

        function adjustChipWeight(chip, dir) {
            if (dragFrom !== null) return;
            var from = Number(chip.dataset.index);
            rebuildPrompt(textarea, container, function (parts) {
                var tag = parts[from];
                if (tag === undefined || tag === "") return false;
                var next = adjustTagWeight(tag, dir);
                if (next === null || next === tag) return false;
                parts[from] = next;
            });
        }

        container.addEventListener(
            "wheel",
            function (e) {
                if (!e.altKey) return;
                var chip = chipFromEvent(e);
                if (!chip) return;
                e.preventDefault();
                e.stopPropagation();
                adjustChipWeight(chip, e.deltaY < 0 ? 1 : -1);
            },
            { passive: false },
        );

        var timer = null;
        function renderNow() {
            if (dragFrom !== null) {
                timer = setTimeout(renderNow, 120);
                return;
            }
            renderTags(textarea, container);
            markSynced(textarea, textarea.value);
        }
        function scheduleRender() {
            if (dragFrom !== null) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(renderNow, DEBOUNCE_MS);
        }

        textarea.addEventListener("input", scheduleRender);
        textarea.addEventListener("change", scheduleRender);
        textarea.addEventListener("focus", function () {
            scheduleRender();
        });

        renderTags(textarea, container);
        markSynced(textarea, textarea.value);
        fields.push({ textarea: textarea, container: container, lastValue: textarea.value });
        return true;
    }

    function init() {
        PROMPT_IDS.forEach(function (id) {
            setup(id);
        });
    }

    function startObserving() {
        var app = getApp();
        var root = app && app.nodeType === 1 ? app : document.body;
        if (!root) return;
        var observer = new MutationObserver(function () {
            PROMPT_IDS.forEach(function (id) {
                var box = getApp().getElementById(id);
                if (box) setup(id);
            });
        });
        observer.observe(root, { childList: true, subtree: true });
    }

    if (typeof window.onUiLoaded === "function") {
        window.onUiLoaded(init);
    } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserving);
    } else {
        startObserving();
    }

    setInterval(pollExternalChanges, 500);
})();
