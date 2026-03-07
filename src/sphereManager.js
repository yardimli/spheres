import {
	MeshBuilder,
	StandardMaterial,
	Color3,
	PhysicsAggregate,
	PhysicsShapeType,
	PhysicsMotionType,
	PointerDragBehavior,
	Vector3,
	Scalar,
	ActionManager,
	ExecuteCodeAction,
	Quaternion
} from "@babylonjs/core";

export class SphereManager {
	constructor(scene, shadowGenerator) {
		this.scene = scene;
		this.shadowGenerator = shadowGenerator;
		this.spheres = [];
		this.selectedSphere = null;
		this.onSelectionChange = null; // Callback for UI
	}

	createSphere(radius = 2, subdivisions = 1) {
		// Create Mesh (Icosphere creates nice uniform triangles)
		const sphere = MeshBuilder.CreateIcoSphere("sphere", {
			radius: radius,
			subdivisions: subdivisions,
			flat: true // Flat shading makes individual triangles visible
		}, this.scene);

		// Random starting position
		sphere.position.y = 5;
		sphere.position.x = Scalar.RandomRange(-10, 10);
		sphere.position.z = Scalar.RandomRange(-10, 10);

		// Material (Blue with flat shading)
		const mat = new StandardMaterial("sphereMat", this.scene);
		mat.diffuseColor = new Color3(0.2, 0.4, 0.8);
		mat.specularColor = new Color3(0.1, 0.1, 0.1);
		sphere.material = mat;

		// Shadow
		this.shadowGenerator.addShadowCaster(sphere);

		// Store sphere properties for UI reference
		sphere.metadata = {
			radius: radius,
			subdivisions: subdivisions
		};

		// Initialize Physics
		this._addPhysics(sphere);

		// Add Drag Behavior
		this._addDragBehavior(sphere);

		// Add Selection Trigger
		sphere.actionManager = new ActionManager(this.scene);
		sphere.actionManager.registerAction(
			new ExecuteCodeAction(
				ActionManager.OnPickTrigger,
				() => {
					this.selectSphere(sphere);
				}
			)
		);

		// Constant Slow Rotation
		this.scene.onBeforeRenderObservable.add(() => {
			if (sphere.physicsBody && sphere.physicsBody.getMotionType() === PhysicsMotionType.DYNAMIC) {
				// Optional: Apply tiny movements here if needed
			}
		});

		this.spheres.push(sphere);
		this.selectSphere(sphere);
	}

	_addPhysics(mesh) {
		// Remove existing aggregate if updating
		if (mesh.physicsBody) {
			mesh.physicsBody.dispose();
		}

		// Create Physics Aggregate
		// Friction 0.5, Restitution 0.7 (bouncy)
		new PhysicsAggregate(
			mesh,
			PhysicsShapeType.SPHERE,
			{ mass: 1, friction: 0.5, restitution: 0.7 },
			this.scene
		);
	}

	_addDragBehavior(mesh) {
		const dragBehavior = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });

		let lastPosition = new Vector3();
		let currentVelocity = new Vector3();
		let lastTime = 0;

		dragBehavior.onDragStartObservable.add(() => {
			this.selectSphere(mesh);
			// Switch to Kinematic (Animated) so user controls position, physics is suspended
			if (mesh.physicsBody) {
				mesh.physicsBody.setMotionType(PhysicsMotionType.ANIMATED);
				// Lift slightly to avoid dragging through ground
				mesh.position.y = Math.max(mesh.position.y, mesh.metadata.radius + 0.5);
			}
			lastPosition.copyFrom(mesh.position);
			lastTime = performance.now();
		});

		dragBehavior.onDragObservable.add(() => {
			const now = performance.now();
			const dt = (now - lastTime) / 1000;
			if (dt > 0) {
				// Calculate velocity for "throw" effect
				const moveDelta = mesh.position.subtract(lastPosition);
				currentVelocity = moveDelta.scale(1 / dt);

				lastPosition.copyFrom(mesh.position);
				lastTime = now;
			}
		});

		dragBehavior.onDragEndObservable.add(() => {
			if (mesh.physicsBody) {
				// Restore Dynamic physics
				mesh.physicsBody.setMotionType(PhysicsMotionType.DYNAMIC);

				// Apply the calculated throw velocity
				// FIX: Use getMassProperties().mass instead of getMass()
				const mass = mesh.physicsBody.getMassProperties().mass;
				const impulse = currentVelocity.scale(mass);

				mesh.physicsBody.applyImpulse(impulse, mesh.getAbsolutePosition());
			}
		});

		mesh.addBehavior(dragBehavior);
	}

	selectSphere(sphere) {
		if (this.selectedSphere === sphere) return;

		// Reset previous highlight
		if (this.selectedSphere && !this.selectedSphere.isDisposed()) {
			this.selectedSphere.material.emissiveColor = Color3.Black();
		}

		this.selectedSphere = sphere;

		// Highlight selection
		this.selectedSphere.material.emissiveColor = new Color3(0.3, 0.3, 0.3);

		// Update UI
		if (this.onSelectionChange) {
			this.onSelectionChange({
				radius: sphere.metadata.radius,
				subdivisions: sphere.metadata.subdivisions
			});
		}
	}

	updateSelectedSphere(radius, subdivisions) {
		if (!this.selectedSphere) return;

		const sphere = this.selectedSphere;

		// Check if values actually changed
		if (sphere.metadata.radius === radius && sphere.metadata.subdivisions === subdivisions) return;

		sphere.metadata.radius = radius;
		sphere.metadata.subdivisions = subdivisions;

		const pos = sphere.position.clone();
		// Handle rotation correctly (Physics uses Quaternions)
		const rot = sphere.rotationQuaternion ? sphere.rotationQuaternion.clone() : sphere.rotation.clone();
		const material = sphere.material;

		// Clean up old
		sphere.dispose();

		// Create New
		const newSphere = MeshBuilder.CreateIcoSphere("sphere", {
			radius: radius,
			subdivisions: subdivisions,
			flat: true
		}, this.scene);

		newSphere.position = pos;
		if (newSphere.rotationQuaternion && rot instanceof Quaternion) {
			newSphere.rotationQuaternion = rot;
		} else {
			newSphere.rotation = rot;
		}
		newSphere.material = material;
		newSphere.metadata = { radius, subdivisions };

		// Re-add behaviors and physics
		this.shadowGenerator.addShadowCaster(newSphere);
		this._addPhysics(newSphere);
		this._addDragBehavior(newSphere);

		// Re-bind click selection
		newSphere.actionManager = new ActionManager(this.scene);
		newSphere.actionManager.registerAction(
			new ExecuteCodeAction(
				ActionManager.OnPickTrigger,
				() => this.selectSphere(newSphere)
			)
		);

		// Update reference in array
		const index = this.spheres.indexOf(sphere);
		if (index !== -1) this.spheres[index] = newSphere;

		this.selectedSphere = newSphere;
		this.selectedSphere.material.emissiveColor = new Color3(0.3, 0.3, 0.3);
	}
}
