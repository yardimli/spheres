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
	VertexBuffer
} from "@babylonjs/core";

export class SphereManager {
	constructor (scene, shadowGenerator) {
		this.scene = scene;
		this.shadowGenerator = shadowGenerator;
		this.spheres = [];
		this.selectedSphere = null;
		this.onSelectionChange = null;
	}

	createSphere (radius = 2, subdivisions = 1) {
		// Create Outer Mesh (Icosphere)
		const sphere = MeshBuilder.CreateIcoSphere("sphere", {
			radius: radius,
			subdivisions: subdivisions,
			flat: true
		}, this.scene);

		// Random starting position (inside the box)
		sphere.position.x = Scalar.RandomRange(-10, 10);
		sphere.position.y = Scalar.RandomRange(-10, 10);
		sphere.position.z = Scalar.RandomRange(-10, 10);

		// Outer Material (Transparent)
		const mat = new StandardMaterial("sphereMat", this.scene);
		mat.diffuseColor = new Color3(0.2, 0.4, 0.8);
		mat.specularColor = new Color3(0.1, 0.1, 0.1);
		mat.alpha = 0.4; // Transparency
		sphere.material = mat;

		// Create Core Mesh (Tetrahedron / Triangle Core)
		// Size is relative to sphere radius
		const core = MeshBuilder.CreatePolyhedron("core", {
			type: 0, // Tetrahedron
			size: radius * 0.4
		}, this.scene);

		// Core Material (Solid, same color)
		const coreMat = new StandardMaterial("coreMat", this.scene);
		coreMat.diffuseColor = mat.diffuseColor;
		coreMat.specularColor = mat.specularColor;
		coreMat.alpha = 1.0; // Solid
		core.material = coreMat;

		// Parent core to sphere so it moves with it
		core.parent = sphere;

		// Shadow
		this.shadowGenerator.addShadowCaster(sphere);
		this.shadowGenerator.addShadowCaster(core);

		// Store sphere properties
		sphere.metadata = {
			radius: radius,
			subdivisions: subdivisions,
			mutations: [],
			coreMesh: core // Keep reference to clean up later
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

		this.spheres.push(sphere);
		this.selectSphere(sphere);
	}

	_addPhysics (mesh) {
		if (mesh.physicsBody) {
			mesh.physicsBody.dispose();
		}

		const hasMutations = mesh.metadata.mutations && mesh.metadata.mutations.length > 0;
		const shapeType = hasMutations ? PhysicsShapeType.CONVEX_HULL : PhysicsShapeType.SPHERE;

		// Create Physics Aggregate
		// Added Damping to simulate drag in zero-G
		const agg = new PhysicsAggregate(
			mesh,
			shapeType,
			{ mass: 1, friction: 0.5, restitution: 0.7 },
			this.scene
		);

		// Set Damping (Drag)
		agg.body.setLinearDamping(1.0);
		agg.body.setAngularDamping(1.0);
	}

	_addDragBehavior (mesh) {
		// Create pointer drag behavior.
		// We do NOT set dragPlaneNormal here initially. We set it on drag start to face camera.
		const dragBehavior = new PointerDragBehavior();

		// Disable automatic mesh movement. We control via Physics velocity.
		dragBehavior.moveAttached = false;
		dragBehavior.useObjectOrientationForDragging = false;

		let isDragging = false;
		const targetPosition = new Vector3();

		// Logic to apply velocity towards target
		const renderObserver = this.scene.onBeforeRenderObservable.add(() => {
			if (!isDragging || !mesh.physicsBody) return;

			const currentPos = mesh.absolutePosition;
			const direction = targetPosition.subtract(currentPos);
			const distance = direction.length();

			if (distance < 0.1) {
				mesh.physicsBody.setLinearVelocity(Vector3.Zero());
				const currentAng = mesh.physicsBody.getAngularVelocity();
				mesh.physicsBody.setAngularVelocity(currentAng.scale(0.9));
				return;
			}

			const speedFactor = 15;
			const desiredVelocity = direction.scale(speedFactor);

			const maxSpeed = 50;
			if (desiredVelocity.length() > maxSpeed) {
				desiredVelocity.normalize().scaleInPlace(maxSpeed);
			}

			mesh.physicsBody.setLinearVelocity(desiredVelocity);

			const currentAngVel = mesh.physicsBody.getAngularVelocity();
			mesh.physicsBody.setAngularVelocity(currentAngVel.scale(0.1));
		});

		dragBehavior.onDragStartObservable.add((event) => {
			this.selectSphere(mesh);

			if (mesh.physicsBody) {
				isDragging = true;
				mesh.physicsBody.setMotionType(PhysicsMotionType.DYNAMIC);

				// Update drag plane to be perpendicular to camera view for intuitive 3D dragging
				if (this.scene.activeCamera) {
					const camDir = this.scene.activeCamera.getForwardRay().direction;
					// Point the normal towards the camera (negative direction)
					dragBehavior.options.dragPlaneNormal = camDir.scale(-1);
				}

				// Initialize target
				targetPosition.copyFrom(event.dragPlanePoint);
			}
		});

		dragBehavior.onDragObservable.add((event) => {
			if (isDragging) {
				// Update target to follow cursor in 3D
				targetPosition.copyFrom(event.dragPlanePoint);
			}
		});

		dragBehavior.onDragEndObservable.add(() => {
			if (mesh.physicsBody) {
				isDragging = false;
				const currentVel = mesh.physicsBody.getLinearVelocity();
				mesh.physicsBody.setLinearVelocity(currentVel.scale(0.5));
			}
		});

		mesh.onDisposeObservable.add(() => {
			this.scene.onBeforeRenderObservable.remove(renderObserver);
		});

		mesh.addBehavior(dragBehavior);
	}

	applyRandomVelocity () {
		if (!this.selectedSphere || !this.selectedSphere.physicsBody) return;

		this.selectedSphere.physicsBody.setMotionType(PhysicsMotionType.DYNAMIC);

		// Random direction in 3D
		const x = Scalar.RandomRange(-1, 1);
		const y = Scalar.RandomRange(-1, 1);
		const z = Scalar.RandomRange(-1, 1);

		const direction = new Vector3(x, y, z).normalize();
		const magnitude = 15;

		const impulse = direction.scale(magnitude);
		this.selectedSphere.physicsBody.applyImpulse(impulse, this.selectedSphere.getAbsolutePosition());
	}

	mutateSelectedSphere () {
		if (!this.selectedSphere) return;

		const mesh = this.selectedSphere;
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		if (!positions) return;

		const vertexCount = positions.length / 3;
		const randomIndex = Math.floor(Math.random() * vertexCount);
		const i = randomIndex * 3;

		const currentPos = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
		const direction = currentPos.normalizeToNew();

		const isOutward = Math.random() > 0.5;
		const magnitude = Scalar.RandomRange(0.3, 1.5);
		const deformationAmount = isOutward ? magnitude : -magnitude;

		const offset = direction.scale(deformationAmount);

		mesh.metadata.mutations.push({
			targetDirection: direction,
			offset: offset
		});

		for (let v = 0; v < vertexCount; v++) {
			const vIdx = v * 3;
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

		mesh.setVerticesData(VertexBuffer.PositionKind, positions);
		mesh.createNormals(true);

		this._addPhysics(mesh);
	}

	_applyStoredMutations (mesh) {
		if (!mesh.metadata.mutations || mesh.metadata.mutations.length === 0) return;

		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		const vertexCount = positions.length / 3;

		mesh.metadata.mutations.forEach(mutation => {
			let closestIndex = -1;
			let maxDot = -1.0;

			for (let v = 0; v < vertexCount; v++) {
				const vIdx = v * 3;
				const vx = positions[vIdx];
				const vy = positions[vIdx + 1];
				const vz = positions[vIdx + 2];
				const len = Math.sqrt(vx * vx + vy * vy + vz * vz);

				const dot = (vx / len) * mutation.targetDirection.x +
					(vy / len) * mutation.targetDirection.y +
					(vz / len) * mutation.targetDirection.z;

				if (dot > maxDot) {
					maxDot = dot;
					closestIndex = vIdx;
				}
			}

			if (closestIndex !== -1 && maxDot > 0.9) {
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

		if (this.selectedSphere && !this.selectedSphere.isDisposed()) {
			// Reset emissive
			this.selectedSphere.material.emissiveColor = Color3.Black();
		}

		this.selectedSphere = sphere;
		this.selectedSphere.material.emissiveColor = new Color3(0.3, 0.3, 0.3);

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
		if (sphere.metadata.radius === radius && sphere.metadata.subdivisions === subdivisions) return;

		const existingMutations = sphere.metadata.mutations || [];
		const pos = sphere.position.clone();
		const rot = sphere.rotationQuaternion ? sphere.rotationQuaternion.clone() : sphere.rotation.clone();
		const material = sphere.material; // Re-use transparent material

		// Dispose old sphere and its children (core)
		sphere.dispose();

		// Create New Sphere
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

		// Re-create Core
		const core = MeshBuilder.CreatePolyhedron("core", {
			type: 0,
			size: radius * 0.4
		}, this.scene);

		const coreMat = new StandardMaterial("coreMat", this.scene);
		coreMat.diffuseColor = material.diffuseColor;
		coreMat.specularColor = material.specularColor;
		coreMat.alpha = 1.0;
		core.material = coreMat;
		core.parent = newSphere;

		newSphere.metadata = {
			radius,
			subdivisions,
			mutations: existingMutations,
			coreMesh: core
		};

		this._applyStoredMutations(newSphere);

		this.shadowGenerator.addShadowCaster(newSphere);
		this.shadowGenerator.addShadowCaster(core);

		this._addPhysics(newSphere);
		this._addDragBehavior(newSphere);

		newSphere.actionManager = new ActionManager(this.scene);
		newSphere.actionManager.registerAction(
			new ExecuteCodeAction(
				ActionManager.OnPickTrigger,
				() => this.selectSphere(newSphere)
			)
		);

		const index = this.spheres.indexOf(sphere);
		if (index !== -1) this.spheres[index] = newSphere;

		this.selectedSphere = newSphere;
		this.selectedSphere.material.emissiveColor = new Color3(0.3, 0.3, 0.3);
	}
}
