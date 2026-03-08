import { Engine, Scene, Vector3, HavokPlugin, ArcRotateCamera } from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { EnvironmentManager } from "./sceneBuilder";
import { SphereManager } from "./sphereManager";
import { createUI } from "./uiManager";

async function initApp() {
	const canvas = document.getElementById("renderCanvas");
	const engine = new Engine(canvas, true);

	// Create Scene
	const scene = new Scene(engine);

	// Initialize Havok Physics
	const havokInstance = await HavokPhysics();
	const hk = new HavokPlugin(true, havokInstance);
	// Gravity set to 0 for zero-G environment
	scene.enablePhysics(new Vector3(0, 0, 0), hk);

	// Camera
	const camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 3, 40, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);

	// Build Environment
	const environmentManager = new EnvironmentManager(scene);
	const shadowGenerator = environmentManager.build();

	// Managers
	const sphereManager = new SphereManager(scene, shadowGenerator);

	// Pass environmentManager to UI so we can control room size
	createUI(sphereManager, environmentManager);

	// Initial Sphere
	sphereManager.createSphere(2, 2);

	// Render Loop
	engine.runRenderLoop(() => {
		scene.render();
	});

	// Resize
	window.addEventListener("resize", () => {
		engine.resize();
	});
}

initApp();
