import {
	MeshBuilder,
	StandardMaterial,
	Color3,
	Color4,
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

		// Walls (Now 6 sides: Top, Bottom, Left, Right, Front, Back)
		this.walls = [];
		this.wallAggregates = [];

		// Visual Boundary
		this.roomBorder = null;

		// Settings
		this.wallThickness = 2;
		this.currentWidth = 50;
		this.currentDepth = 50;
		this.currentHeight = 50;
	}

	build () {
		// Ambient light
		const ambientLight = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
		ambientLight.intensity = 0.4;

		// Spotlight to cast shadows (Positioned outside the box)
		const spotLight = new SpotLight("spotLight", new Vector3(0, 60, 0), new Vector3(0, -1, 0), Math.PI / 2, 5, this.scene);
		spotLight.intensity = 0.8;

		// Create 6 Walls (Invisible)
		// 0: Top, 1: Bottom, 2: Right, 3: Left, 4: Front, 5: Back
		for (let i = 0; i < 6; i++) {
			const wall = MeshBuilder.CreateBox("wall_" + i, { size: 1 }, this.scene);
			wall.isVisible = false; // Make invisible
			this.walls.push(wall);
			this.wallAggregates.push(null);
		}

		// Create Visual Room Edges
		// We create a box that matches the inner dimensions of the room
		this.roomBorder = MeshBuilder.CreateBox("roomBorder", { size: 1 }, this.scene);
		const borderMat = new StandardMaterial("borderMat", this.scene);
		borderMat.alpha = 0; // Invisible faces
		this.roomBorder.material = borderMat;

		// Enable Edges Rendering to show the wireframe box
		this.roomBorder.enableEdgesRendering();
		this.roomBorder.edgesWidth = 4.0;
		this.roomBorder.edgesColor = new Color4(1, 1, 1, 1); // White edges

		// Ensure it doesn't interfere with physics or picking
		this.roomBorder.isPickable = false;
		this.roomBorder.checkCollisions = false;

		// Shadows
		this.shadowGenerator = new ShadowGenerator(1024, spotLight);
		this.shadowGenerator.useBlurExponentialShadowMap = true;
		this.shadowGenerator.blurKernel = 32;

		// Initial sizing
		this.updateRoomDimensions(50, 50, 50);

		return this.shadowGenerator;
	}

	updateRoomDimensions (width, depth, height = 50) {
		this.currentWidth = width;
		this.currentDepth = depth;
		this.currentHeight = height;

		// Update Visual Border Size
		if (this.roomBorder) {
			this.roomBorder.scaling.x = width;
			this.roomBorder.scaling.y = height;
			this.roomBorder.scaling.z = depth;
		}

		const halfW = width / 2;
		const halfD = depth / 2;
		const halfH = height / 2;
		const offset = this.wallThickness / 2;

		// Configuration: Position and Scaling for each wall
		const wallConfigs = [
			{ // Top (+Y)
				pos: new Vector3(0, halfH + offset, 0),
				scale: new Vector3(width + 2 * this.wallThickness, this.wallThickness, depth + 2 * this.wallThickness)
			},
			{ // Bottom (-Y)
				pos: new Vector3(0, -halfH - offset, 0),
				scale: new Vector3(width + 2 * this.wallThickness, this.wallThickness, depth + 2 * this.wallThickness)
			},
			{ // Right (+X)
				pos: new Vector3(halfW + offset, 0, 0),
				scale: new Vector3(this.wallThickness, height, depth)
			},
			{ // Left (-X)
				pos: new Vector3(-halfW - offset, 0, 0),
				scale: new Vector3(this.wallThickness, height, depth)
			},
			{ // Front (+Z)
				pos: new Vector3(0, 0, halfD + offset),
				scale: new Vector3(width, height, this.wallThickness)
			},
			{ // Back (-Z)
				pos: new Vector3(0, 0, -halfD - offset),
				scale: new Vector3(width, height, this.wallThickness)
			}
		];

		// Apply Configs
		for (let i = 0; i < 6; i++) {
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
