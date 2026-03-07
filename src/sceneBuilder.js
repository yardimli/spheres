import {
	MeshBuilder,
	StandardMaterial,
	Color3,
	PhysicsAggregate,
	PhysicsShapeType,
	SpotLight,
	HemisphericLight,
	Vector3,
	ShadowGenerator
} from "@babylonjs/core";

export class EnvironmentManager {
	constructor (scene) {
		this.scene = scene;
		this.shadowGenerator = null;

		// Ground and Walls
		this.ground = null;
		this.groundAggregate = null;
		this.walls = [];
		this.wallAggregates = [];

		// Settings
		this.wallHeight = 50;
		this.wallThickness = 2;
		this.currentWidth = 100;
		this.currentDepth = 100;
	}

	build () {
		// Ambient light
		const ambientLight = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
		ambientLight.intensity = 0.4;

		// Spotlight to cast shadows
		const spotLight = new SpotLight("spotLight", new Vector3(0, 30, 0), new Vector3(0, -1, 0), Math.PI / 2, 2, this.scene);
		spotLight.intensity = 0.8;

		// Ground Mesh
		// We start with 1x1 and scale it in updateGroundDimensions
		this.ground = MeshBuilder.CreateGround("ground", { width: 1, height: 1 }, this.scene);
		const groundMat = new StandardMaterial("groundMat", this.scene);
		groundMat.diffuseColor = new Color3(0.5, 0.5, 0.5);
		this.ground.material = groundMat;
		this.ground.receiveShadows = true;

		// Create 4 Walls (Invisible)
		for (let i = 0; i < 4; i++) {
			const wall = MeshBuilder.CreateBox("wall_" + i, { size: 1 }, this.scene);
			wall.isVisible = false; // Make invisible
			this.walls.push(wall);
			this.wallAggregates.push(null);
		}

		// Shadows
		this.shadowGenerator = new ShadowGenerator(1024, spotLight);
		this.shadowGenerator.useBlurExponentialShadowMap = true;
		this.shadowGenerator.blurKernel = 32;

		// Initial sizing
		this.updateGroundDimensions(100, 100);

		return this.shadowGenerator;
	}

	updateGroundDimensions (width, depth) {
		this.currentWidth = width;
		this.currentDepth = depth;

		// 1. Update Ground Scaling
		this.ground.scaling.x = width;
		this.ground.scaling.z = depth;

		// Update Ground Physics
		// We must recreate the aggregate to match the new scaling/shape
		if (this.groundAggregate) {
			this.groundAggregate.dispose();
		}
		this.groundAggregate = new PhysicsAggregate(
			this.ground,
			PhysicsShapeType.BOX,
			{ mass: 0, friction: 0.8, restitution: 0.6 },
			this.scene
		);

		// 2. Update Walls
		// Wall 0: +Z (Top)
		// Wall 1: -Z (Bottom)
		// Wall 2: +X (Right)
		// Wall 3: -X (Left)
		const halfW = width / 2;
		const halfD = depth / 2;
		const offset = this.wallThickness / 2;

		// Configuration: Position and Scaling for each wall
		const wallConfigs = [
			{ // Top
				pos: new Vector3(0, this.wallHeight / 2, halfD + offset),
				scale: new Vector3(width + 2 * this.wallThickness, this.wallHeight, this.wallThickness)
			},
			{ // Bottom
				pos: new Vector3(0, this.wallHeight / 2, -halfD - offset),
				scale: new Vector3(width + 2 * this.wallThickness, this.wallHeight, this.wallThickness)
			},
			{ // Right
				pos: new Vector3(halfW + offset, this.wallHeight / 2, 0),
				scale: new Vector3(this.wallThickness, this.wallHeight, depth)
			},
			{ // Left
				pos: new Vector3(-halfW - offset, this.wallHeight / 2, 0),
				scale: new Vector3(this.wallThickness, this.wallHeight, depth)
			}
		];

		// Apply Configs
		for (let i = 0; i < 4; i++) {
			const wall = this.walls[i];
			wall.position.copyFrom(wallConfigs[i].pos);
			wall.scaling.copyFrom(wallConfigs[i].scale);

			// Update Wall Physics
			if (this.wallAggregates[i]) {
				this.wallAggregates[i].dispose();
			}
			// Friction 0 to prevent sticking, Restitution 1.0 for bounciness
			this.wallAggregates[i] = new PhysicsAggregate(
				wall,
				PhysicsShapeType.BOX,
				{ mass: 0, friction: 0.0, restitution: 1.0 },
				this.scene
			);
		}
	}
}
