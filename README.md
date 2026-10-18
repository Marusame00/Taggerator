# Taggerator

A small drag-and-drop **tag separator** for the prompt boxes of Stable Diffusion WebUI Forge Classic.

When you type comma-separated words into a prompt box, Taggerator renders them as a list of draggable tag chips underneath the box. Drag a chip left or right and the matching text moves to its new place in the prompt, in real time.

Inspired by the tag-reordering feature of [sd-webui-prompt-all-in-one](https://github.com/Physton/sd-webui-prompt-all-in-one) — without the rest of that project, and without any Python code of its own, so it should survive Forge updates.

## Features

- Comma-separated prompt words appear as chips under the prompt box
- Drag a chip to reorder the text in the prompt — the textarea is updated immediately
- Works on all prompt boxes: txt2img, img2img, negative prompts, and the hires fix prompt fields
- **Shift + Click** on a chip moves it one position to the left (keyboard-friendly alternative)
- Bracket-aware splitting: `(a, b)`, `[a|b]`, `{a, b}`, `<lora:name:0.8>` are each kept intact as a single tag
- Keeps prompts tidy: after a reorder, tags are trimmed and rejoined with a single space, so the prompt always reads `tag1, tag2, tag3`
- Pure frontend — no Python, no settings, nothing to break

## Install

From the **Extensions** tab of the WebUI:

1. Click **Install from URL**
2. Paste `https://github.com/Marusame00/Taggerator.git`
3. Click **Install**, then **Apply and restart UI**

Or manually, from a shell:

```sh
git clone https://github.com/Marusame00/Taggerator.git extensions/Taggerator
```

Then restart the WebUI.

## Usage

Type a prompt like this into any prompt box:

```
masterpiece, best quality, 1girl, (solo:1.2), forest
```

Four chips appear underneath: `masterpiece`, `best quality`, `1girl`, `(solo:1.2)`, `forest`. Drag `forest` to the front and the prompt becomes:

```
forest, masterpiece, best quality, 1girl, (solo:1.2)
```

The chip list refreshes as you type (with a short debounce) and hides itself when there is nothing to reorder.

## Compatibility

- Built and tested against [sd-webui-forge-classic](https://github.com/Haoming02/sd-webui-forge-classic) (the `neo` branch / Forge Classic build)
- Likely works on other Forge and A1111-derived builds too, since it only uses DOM ids and Forge's `updateInput`/`onUiLoaded` globals (with plain-event fallbacks if those are missing)
- No `install.py`, no `requirements.txt`, no Python entry point — the JavaScript and stylesheet are loaded automatically by the WebUI's extension loader

## Roadmap

- Pointer/touch drag support
- Delete a tag with double-click
- Toggle Taggerator per prompt box

## License

[MIT](LICENSE)
