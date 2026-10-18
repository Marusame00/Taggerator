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
            chip.title = label;
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
            if (!e.shiftKey) return;
            var chip = chipFromEvent(e);
            if (!chip) return;
            var from = Number(chip.dataset.index);
            commitReorder(textarea, container, from, from - 1);
        });

        var timer = null;
        function renderNow() {
            if (dragFrom !== null) {
                timer = setTimeout(renderNow, 120);
                return;
            }
            renderTags(textarea, container);
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
})();
