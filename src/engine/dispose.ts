import * as THREE from 'three';

/**
 * Recursively dispose every geometry, material and texture under an object,
 * then detach it from its parent. Called when a game tab is left so we never
 * leak GPU memory across the home -> game -> home loop.
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else disposeMaterial(mat);
    }
  });
  root.parent?.remove(root);
}

/**
 * Free every GPU resource a game's scene holds — geometry, materials, textures —
 * then empty the scene. Games call this from dispose() so nothing leaks across
 * the home -> game -> home loop. (Previously each game freed geometry only.)
 */
export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else disposeMaterial(mat);
    }
  });
  const bg = scene.background;
  if (bg && (bg as THREE.Texture).isTexture) (bg as THREE.Texture).dispose();
  scene.clear();
}

function disposeMaterial(material: THREE.Material): void {
  const m = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    const value = m[key];
    if (value && typeof value === 'object' && 'isTexture' in value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}
