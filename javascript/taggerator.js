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

    function splitOnTopLevelCommas(text) {
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
            } else if (ch === "," && stack.length === 0) {
                parts.push(cur);
                cur = "";
            } else {
                cur += ch;
            }
        }
        parts.push(cur);
        return parts;
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

    function renderTags(textarea, container) {
        var text = textarea.value;
        var parts = splitOnTopLevelCommas(text);
        var meaningful = 0;
        for (var p = 0; p < parts.length; p++) {
            if (parts[p].trim() !== "") meaningful++;
        }
        container.replaceChildren();
        if (text.trim() === "" || parts.length < 2 || meaningful < 2) {
            container.classList.add("hidden");
            return;
        }
        container.classList.remove("hidden");

        var shown = parts.slice(0, MAX_TAGS);
        var overflow = parts.length - shown.length;
        shown.forEach(function (part, i) {
            var chip = document.createElement("div");
            chip.className = "taggerator-chip";
            chip.draggable = true;
            chip.setAttribute("data-index", String(i));
            var label = part.trim();
            chip.title = label === "" ? label : label + "  (Alt+scroll: weight, Alt+click: delete)";
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

    function commitReorder(textarea, container, from, to) {
        if (from === to) return;
        var parts = splitOnTopLevelCommas(textarea.value).map(function (p) {
            return p.trim();
        });
        var moved = parts.splice(from, 1)[0];
        var target = to - (from < to ? 1 : 0);
        parts.splice(target, 0, moved);
        textarea.value = parts.join(", ");
        fireInput(textarea);
        renderTags(textarea, container);
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
                to = splitOnTopLevelCommas(textarea.value).length;
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
            var parts = splitOnTopLevelCommas(textarea.value).map(function (p) {
                return p.trim();
            });
            if (parts[from] === undefined) return;
            parts.splice(from, 1);
            textarea.value = parts.join(", ");
            fireInput(textarea);
            renderTags(textarea, container);
            markSynced(textarea, textarea.value);
        }

        function adjustChipWeight(chip, dir) {
            if (dragFrom !== null) return;
            var from = Number(chip.dataset.index);
            var parts = splitOnTopLevelCommas(textarea.value).map(function (p) {
                return p.trim();
            });
            var tag = parts[from];
            if (tag === undefined || tag === "") return;
            var next = adjustTagWeight(tag, dir);
            if (next === null || next === tag) return;
            parts[from] = next;
            textarea.value = parts.join(", ");
            fireInput(textarea);
            renderTags(textarea, container);
            markSynced(textarea, textarea.value);
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
