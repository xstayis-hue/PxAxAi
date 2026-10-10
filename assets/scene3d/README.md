# PXAX Ai 3D scene assets

The rigged female character, long hairstyle, outfit, and selected animation clips are
from Quaternius' Universal Base Characters, Modular Character Outfits, and Universal
Animation Library packs. These assets are released under CC0 1.0.

- Original asset packs: https://quaternius.com/
- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- Source mirror and license copy: https://github.com/Dallolz/moorfall-assets

`animations-core.glb` contains only the idle, talking, walking, sitting, and interaction
clips extracted from Quaternius' `UAL1.glb`.

All `.glb` files here are stored **meshopt-compressed** (`EXT_meshopt_compression` +
`EXT_texture_webp` + `KHR_mesh_quantization`) — this cut the first-load payload from
5.7 MB to about 0.75 MB. Decoding is transparent to the client: `scene3d.js` registers
`MeshoptDecoder` on the `GLTFLoader`. If you re-export a model, re-run the same pipeline
or the app will fail to parse it:

```bash
npx @gltf-transform/cli optimize in.glb out.glb \
  --compress meshopt --texture-compress webp --texture-size 512 \
  --simplify false --flatten false --join false --instance false --palette false
```

(`--simplify false` keeps the character topology intact; `--flatten/--join false` keeps
the bone names, which the wardrobe retargeting depends on.)
