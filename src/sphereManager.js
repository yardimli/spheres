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
	constructor (scene, shadowGenerator) {
		this.scene = scene;
		this.shadowGenerator = shadowGenerator;
		this.spheres = [];
		this.selectedSphere = null;
		this.onSelectionChange = null; // Callback for UI
	}

	createSphere (radius = 2, subdivisions = 1) {
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

	_addPhysics (mesh) {
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

	_addDragBehavior (mesh) {
		// Create pointer drag behavior on X, Z plane
		const dragBehavior = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });

		// Disable automatic mesh movement. We will control movement via Physics velocity.
		dragBehavior.moveAttached = false;

		// Disable orientation use to keep drag plane consistent
		dragBehavior.useObjectOrientationForDragging = false;

		let isDragging = false;
		const targetPosition = new Vector3();
		const liftHeight = 0.5; // How high to lift the sphere while dragging

		// Logic to apply velocity towards target
		// This runs every frame to smoothly guide the sphere to the cursor
		const renderObserver = this.scene.onBeforeRenderObservable.add(() => {
			if (!isDragging || !mesh.physicsBody) return;

			const currentPos = mesh.absolutePosition;

			// Calculate vector from current position to target (cursor) position
			const direction = targetPosition.subtract(currentPos);
			const distance = direction.length();

			// Deadzone: If very close, stop moving to prevent jitter
			if (distance < 0.1) {
				mesh.physicsBody.setLinearVelocity(Vector3.Zero());
				// Dampen angular velocity so it doesn't roll forever in place
				const currentAng = mesh.physicsBody.getAngularVelocity();
				mesh.physicsBody.setAngularVelocity(currentAng.scale(0.9));
				return;
			}

			// Calculate Desired Velocity
			// We use a proportional control: Velocity = Distance * SpeedFactor
			// This naturally slows down as it approaches the target,
			// and reverses direction if it overshoots.
			const speedFactor = 15; // Adjust this for "stiffness" of the drag
			const desiredVelocity = direction.scale(speedFactor);

			// Optional: Clamp max speed to prevent physics instability on fast mouse movements
			const maxSpeed = 50;
			if (desiredVelocity.length() > maxSpeed) {
				desiredVelocity.normalize().scaleInPlace(maxSpeed);
			}

			// Apply the velocity to the physics body
			mesh.physicsBody.setLinearVelocity(desiredVelocity);

			// Apply heavy angular damping while dragging
			// This prevents the ball from spinning wildly while being carried,
			// giving it a feeling of being "held"
			const currentAngVel = mesh.physicsBody.getAngularVelocity();
			mesh.physicsBody.setAngularVelocity(currentAngVel.scale(0.1));
		});

		dragBehavior.onDragStartObservable.add((event) => {
			this.selectSphere(mesh);

			if (mesh.physicsBody) {
				isDragging = true;

				// Ensure physics is DYNAMIC (it should be already, but just in case)
				// We do NOT switch to Kinematic/Animated because we want to use Velocity
				mesh.physicsBody.setMotionType(PhysicsMotionType.DYNAMIC);

				// Initialize target position from the click point
				// Lift Y position so it doesn't scrape the ground
				targetPosition.copyFrom(event.dragPlanePoint);
				targetPosition.y = mesh.metadata.radius + liftHeight;
			}
		});

		dragBehavior.onDragObservable.add((event) => {
			if (isDragging) {
				// Update target X/Z to follow cursor
				targetPosition.x = event.dragPlanePoint.x;
				targetPosition.z = event.dragPlanePoint.z;

				// Keep Y locked at the lifted height
				targetPosition.y = mesh.metadata.radius + liftHeight;
			}
		});

		dragBehavior.onDragEndObservable.add(() => {
			if (mesh.physicsBody) {
				isDragging = false;

				// Optional: Reduce velocity on release so it doesn't fly off too fast
				// if the mouse was moving quickly
				const currentVel = mesh.physicsBody.getLinearVelocity();
				mesh.physicsBody.setLinearVelocity(currentVel.scale(0.5));
			}
		});

		// Clean up observer if the mesh is destroyed (e.g. resized via UI)
		mesh.onDisposeObservable.add(() => {
			this.scene.onBeforeRenderObservable.remove(renderObserver);
		});

		mesh.addBehavior(dragBehavior);
	}

	/**
	 * Applies a random velocity to the currently selected sphere.
	 */
	applyRandomVelocity () {
		if (!this.selectedSphere || !this.selectedSphere.physicsBody) return;

		// Ensure it is dynamic before applying impulse
		this.selectedSphere.physicsBody.setMotionType(PhysicsMotionType.DYNAMIC);

		// Create a random direction vector
		const x = Scalar.RandomRange(-1, 1);
		const z = Scalar.RandomRange(-1, 1);
		const y = Scalar.RandomRange(0.2, 1); // Biased upwards for a "jump" effect

		const direction = new Vector3(x, y, z).normalize();
		const magnitude = 15; // Force strength

		// Apply impulse (Mass * Velocity change)
		const impulse = direction.scale(magnitude);

		// Apply to the center of mass
		this.selectedSphere.physicsBody.applyImpulse(impulse, this.selectedSphere.getAbsolutePosition());
	}

	selectSphere (sphere) {
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

	updateSelectedSphere (radius, subdivisions) {
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
