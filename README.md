# Anatomy 3D

Interactive 3D human anatomy for learning. Plain HTML/CSS/JS with a local copy of three.js r128: no bundler,
no framework, no runtime build step.

Serve the folder with any static server and open it:

    python3 -m http.server 8765      # then http://localhost:8765/

## Features

- 164 parts in five systems (skeleton, muscles, organs, circulatory, nervous), each with a description and a function text
- Sculpted procedural models: ribcage with sternum and costal cartilage, vertebrae and discs, hip bones, skull with
  jaw and teeth, folded brain with four lobes per hemisphere and cerebellum, hands and feet, two muscle layers with
  tendons, heart with coronary vessels, lungs, liver, intestines, vessels and nerves
- PBR materials, environment lighting, soft shadows, ACES tone mapping, outlines on hover/selection, fade transitions
- Grouped parts tree with search, system presets, show/hide, isolate, focus, cross-section plane, leader-line labels
- Quiz: "Find it" (click the part) and "Name it" (multiple choice), 10-question rounds with points, streaks, hints and review
- Light and dark themes, keyboard shortcuts (`?`), touch controls, responsive phone layout

## How the model is made

There are no third-party meshes. Geometry is generated from signed-distance primitives (`js/sdf.js`, surface-nets
mesher) and tube sweeps, described in `js/model_bones.js` and `js/model_soft.js`, and catalogued in `js/data.js`.
`tools/bake.js` runs that generator in Node and packs the result into `assets/anatomy.bin.gz` (quantised, gzip),
which the page loads. If the baked file is missing the page falls back to generating the meshes in the browser (slow).

After changing any model or catalogue file:

    node tools/bake.js

## Tests

Open `/?selftest`; results land in `<html data-selftest>` and the console (parts, picking, search, quiz, section, theme).

## Credits and licences

- three.js r128, MIT (`lib/`)
- Anatomy text and models in this project are original work. This is an educational illustration, not a medical reference.
- Considered but not used: Z-Anatomy (CC BY-SA 4.0, Blender-only) and BodyParts3D (CC BY-SA, STL), because no
  directly downloadable glTF/GLB with a permissive licence was available and share-alike would apply to this project.
