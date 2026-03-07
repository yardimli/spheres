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
	Quaternion,
	VertexBuffer // Added import
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
			subdivisions: subdivisions,
			mutations: [] // Store list of vertex deformations
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

		// Determine shape based on mutations.
		// If mutated, the geometry is no longer a perfect sphere, so we use Convex Hull.
		// Note: Convex Hull is more expensive than Sphere, but necessary for accurate collisions on deformed meshes.
		const hasMutations = mesh.metadata.mutations && mesh.metadata.mutations.length > 0;
		const shapeType = hasMutations ? PhysicsShapeType.CONVEX_HULL : PhysicsShapeType.SPHERE;

		// Create Physics Aggregate
		// Friction 0.5, Restitution 0.7 (bouncy)
		new PhysicsAggregate(
			mesh,
			shapeType,
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

	/**
	 * Deforms the selected sphere by moving a random vertex outward.
	 */
	mutateSelectedSphere () {
		if (!this.selectedSphere) return;

		const mesh = this.selectedSphere;
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		if (!positions) return;

		// 1. Pick a random vertex index (stride is 3)
		const vertexCount = positions.length / 3;
		const randomIndex = Math.floor(Math.random() * vertexCount);
		const i = randomIndex * 3;

		// 2. Calculate local position and normal direction
		const currentPos = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
		const direction = currentPos.normalizeToNew(); // Assuming center is 0,0,0

		// 3. Create a deformation vector
		const deformationAmount = Scalar.RandomRange(0.5, 1.5);
		const offset = direction.scale(deformationAmount);

		// 4. Store mutation for persistence across recreations.
		// We store the direction vector to find the "same" point later if resolution changes.
		mesh.metadata.mutations.push({
			targetDirection: direction,
			offset: offset
		});

		// 5. Apply to current geometry
		// Since we use flat shading, multiple vertices might occupy the same point.
		// To make it look solid, we move all vertices that are at this location.
		for (let v = 0; v < vertexCount; v++) {
			const vIdx = v * 3;
			// Check if this vertex is at the same location as the picked one
			if (
				Scalar.WithinEpsilon(positions[vIdx], currentPos.x, 0.001) &&
				Scalar.WithinEpsilon(positions[vIdx + 1], currentPos.y, 0.001) &&
				Scalar.WithinEpsilon(positions[vIdx + 2], currentPos.z, 0.001)
			) {
				positions[vIdx] += offset.x;
				positions[vIdx + 1] += offset.y;
				positions[vIdx + 2] += offset.z;
			}
		}

		// 6. Update Mesh
		mesh.setVerticesData(VertexBuffer.PositionKind, positions);
		mesh.createNormals(true); // Re-calculate normals for lighting

		// 7. Re-initialize Physics (Must switch to Convex Hull to match new shape)
		this._addPhysics(mesh);
	}

	/**
	 * Applies stored mutations to a newly created mesh.
	 * This ensures deformations persist when changing radius or subdivisions.
	 */
	_applyStoredMutations (mesh) {
		if (!mesh.metadata.mutations || mesh.metadata.mutations.length === 0) return;

		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		const vertexCount = positions.length / 3;

		// For each stored mutation
		mesh.metadata.mutations.forEach(mutation => {
			// Find the vertex on the new mesh that is closest to the mutation direction
			let closestIndex = -1;
			let maxDot = -1.0;

			// Search for closest vertex by checking dot product of directions
			for (let v = 0; v < vertexCount; v++) {
				const vIdx = v * 3;
				// Simple normalized check
				const vx = positions[vIdx];
				const vy = positions[vIdx + 1];
				const vz = positions[vIdx + 2];
				const len = Math.sqrt(vx * vx + vy * vy + vz * vz);

				// Dot product
				const dot = (vx / len) * mutation.targetDirection.x +
					(vy / len) * mutation.targetDirection.y +
					(vz / len) * mutation.targetDirection.z;

				if (dot > maxDot) {
					maxDot = dot;
					closestIndex = vIdx;
				}
			}

			// Apply the offset to the closest vertex (and coincident ones for watertightness)
			if (closestIndex !== -1 && maxDot > 0.9) { // Threshold to ensure we are reasonably close
				const targetX = positions[closestIndex];
				const targetY = positions[closestIndex + 1];
				const targetZ = positions[closestIndex + 2];

				for (let v = 0; v < vertexCount; v++) {
					const vIdx = v * 3;
					if (
						Scalar.WithinEpsilon(positions[vIdx], targetX, 0.001) &&
						Scalar.WithinEpsilon(positions[vIdx + 1], targetY, 0.001) &&
						Scalar.WithinEpsilon(positions[vIdx + 2], targetZ, 0.001)
					) {
						positions[vIdx] += mutation.offset.x;
						positions[vIdx + 1] += mutation.offset.y;
						positions[vIdx + 2] += mutation.offset.z;
					}
				}
			}
		});

		mesh.setVerticesData(VertexBuffer.PositionKind, positions);
		mesh.createNormals(true);
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

		// Persist existing mutations
		const existingMutations = sphere.metadata.mutations || [];

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
		newSphere.metadata = {
			radius,
			subdivisions,
			mutations: existingMutations
		};

		// Re-apply mutations to the new geometry
		this._applyStoredMutations(newSphere);

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
