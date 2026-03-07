import { MeshBuilder, StandardMaterial, Color3, PhysicsAggregate, PhysicsShapeType, SpotLight, HemisphericLight, Vector3, ShadowGenerator } from "@babylonjs/core";

export function buildEnvironment(scene) {
	// Ambient light
	const ambientLight = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
	ambientLight.intensity = 0.4;

	// Spotlight to cast shadows
	const spotLight = new SpotLight("spotLight", new Vector3(0, 30, 0), new Vector3(0, -1, 0), Math.PI / 2, 2, scene);
	spotLight.intensity = 0.8;

	// Ground
	const ground = MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, scene);
	const groundMat = new StandardMaterial("groundMat", scene);
	groundMat.diffuseColor = new Color3(0.5, 0.5, 0.5);
	ground.material = groundMat;
	ground.receiveShadows = true;

	// Static physics for ground (so spheres bounce and don't fall through)
	new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.6 }, scene);

	// Shadows
	const shadowGenerator = new ShadowGenerator(1024, spotLight);
	shadowGenerator.useBlurExponentialShadowMap = true;
	shadowGenerator.blurKernel = 32;

	return shadowGenerator;
}
