// src/rodManager.js

import {
	Vector3,
	Color3,
	MeshBuilder,
	StandardMaterial,
	Matrix,
	Quaternion,
	Physics6DoFConstraint,
	PhysicsConstraintAxis,
	PhysicsMotionType,
	Animation,
	PointerEventTypes,
	PhysicsAggregate,
	PhysicsShapeType,
	PointerDragBehavior, // Added for dragging
	Scalar // Added for random spawning
} from "@babylonjs/core";

export class RodManager {
	constructor (scene, sphereManager) {
		this.scene = scene;
		this.sphereManager = sphereManager;

		// Configuration
		this.rodLength = 10; // Default length
		this.rodWallThickness = 0.2;
		this.rodDiameter = 1;

		// State
		this.selectedRod = null;
		this.rods =[]; // Store active rods
		this.lastDragTime = 0; // Track rod drag end time to prevent accidental clicks

		// Materials
		this.rodMat = new StandardMaterial("rodMat", scene);
		this.rodMat.diffuseColor = new Color3(0.6, 0.6, 0.7);
		this.rodMat.alpha = 0.5; // Opacity as requested
		this.rodMat.backFaceCulling = false; // Visible from inside

		this.selectedRodMat = new StandardMaterial("selRodMat", scene);
		this.selectedRodMat.diffuseColor = new Color3(1, 0.5, 0); // Orange
		this.selectedRodMat.alpha = 0.6;
		this.selectedRodMat.backFaceCulling = false;

		this._initInteraction();
	}

	_initInteraction () {
		// Use PointerObservable to handle interaction logic more granularly
		this.scene.onPointerObservable.add((pointerInfo) => {
			if (pointerInfo.event.button !== 0) return; // Left click only

			// Check if a drag operation just finished recently (within 200ms) for either spheres or rods
			const sphereDragged = this.sphereManager.lastDragTime && (Date.now() - this.sphereManager.lastDragTime < 200);
			const rodDragged = this.lastDragTime && (Date.now() - this.lastDragTime < 200);

			if (sphereDragged || rodDragged) {
				return;
			}

			const pickInfo = pointerInfo.pickInfo;

			// Check if we clicked a Rod
			if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name === "connectionRod") {
				this._selectRod(pickInfo.pickedMesh);
				return;
			}

			// Check if we clicked a Core Face
			if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name === "core") {
				// Only handle face click if a rod is currently selected
				if (this.selectedRod) {
					this._handleFaceClick(pickInfo);
				}
				return;
			}

			// Clicked elsewhere
			this._deselectRod();
		}, PointerEventTypes.POINTERUP);
	}

	// Spawns a standalone rod into the scene
	spawnRod () {
		const length = this.rodLength;
		const outerRadius = this.rodDiameter / 2;
		const innerRadius = outerRadius - this.rodWallThickness;

		// Create a hollow cylinder using a Lathe centered at the origin
		const shape =[
			new Vector3(innerRadius, -length / 2, 0),
			new Vector3(outerRadius, -length / 2, 0),
			new Vector3(outerRadius, length / 2, 0),
			new Vector3(innerRadius, length / 2, 0),
			new Vector3(innerRadius, -length / 2, 0)
		];

		const rod = MeshBuilder.CreateLathe("connectionRod", {
			shape: shape,
			radius: 1,
			tessellation: 24,
			sideOrientation: 2 // DOUBLESIDE
		}, this.scene);

		// Spawn at a random position inside the room bounds
		rod.position.x = Scalar.RandomRange(-10, 10);
		rod.position.y = Scalar.RandomRange(-10, 10);
		rod.position.z = Scalar.RandomRange(-10, 10);

		// Random initial rotation
		rod.rotationQuaternion = Quaternion.FromEulerAngles(
			Scalar.RandomRange(0, Math.PI * 2),
			Scalar.RandomRange(0, Math.PI * 2),
			Scalar.RandomRange(0, Math.PI * 2)
		);

		rod.material = this.rodMat;
		rod.isPickable = true;

		// Make the rod a physical object
		const rodAgg = new PhysicsAggregate(
			rod,
			PhysicsShapeType.CONVEX_HULL,
			{ mass: 0.5, friction: 0.5, restitution: 0.5 },
			this.scene
		);
		rodAgg.body.setLinearDamping(1.0);
		rodAgg.body.setAngularDamping(1.0);

		// Initialize metadata to track attachments
		rod.metadata = {
			length: length,
			attachedA: null, // Will store { sphere, constraint }
			attachedB: null
		};

		// Add drag behavior to the new rod
		this._addDragBehavior(rod);

		this.rods.push(rod);
		this._selectRod(rod);
	}

	// Adds pointer drag behavior to move the rod around
	_addDragBehavior (mesh) {
		const dragBehavior = new PointerDragBehavior();

		// Disable automatic mesh movement. We control via Physics velocity.
		dragBehavior.moveAttached = false;
		dragBehavior.useObjectOrientationForDragging = false;

		let isDragging = false;
		let hasMoved = false;
		const targetPosition = new Vector3();

		// Logic to apply velocity towards target
		const renderObserver = this.scene.onBeforeRenderObservable.add(() => {
			if (!isDragging || !hasMoved || !mesh.physicsBody) return;

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
			this._selectRod(mesh);

			if (mesh.physicsBody) {
				isDragging = true;
				hasMoved = false; // Reset movement flag
				mesh.physicsBody.setMotionType(PhysicsMotionType.DYNAMIC);

				// Update drag plane to be perpendicular to camera view for intuitive 3D dragging
				if (this.scene.activeCamera) {
					const camDir = this.scene.activeCamera.getForwardRay().direction;
					dragBehavior.options.dragPlaneNormal = camDir.scale(-1);
				}

				targetPosition.copyFrom(event.dragPlanePoint);
			}
		});

		dragBehavior.onDragObservable.add((event) => {
			if (isDragging) {
				hasMoved = true;
				targetPosition.copyFrom(event.dragPlanePoint);
			}
		});

		dragBehavior.onDragEndObservable.add(() => {
			if (mesh.physicsBody) {
				isDragging = false;
				hasMoved = false;
				const currentVel = mesh.physicsBody.getLinearVelocity();
				mesh.physicsBody.setLinearVelocity(currentVel.scale(0.5));

				// Record timestamp to prevent conflict with click selection
				this.lastDragTime = Date.now();
			}
		});

		mesh.onDisposeObservable.add(() => {
			this.scene.onBeforeRenderObservable.remove(renderObserver);
		});

		mesh.addBehavior(dragBehavior);
	}

	_getFaceData (mesh, faceId) {
		const indices = mesh.getIndices();
		const positions = mesh.getVerticesData("position");

		if (!indices || !positions) return null;

		const i1 = indices[faceId * 3];
		const i2 = indices[faceId * 3 + 1];
		const i3 = indices[faceId * 3 + 2];

		const v1 = Vector3.FromArray(positions, i1 * 3);
		const v2 = Vector3.FromArray(positions, i2 * 3);
		const v3 = Vector3.FromArray(positions, i3 * 3);

		// Transform to world space
		const worldMatrix = mesh.computeWorldMatrix(true);
		const v1w = Vector3.TransformCoordinates(v1, worldMatrix);
		const v2w = Vector3.TransformCoordinates(v2, worldMatrix);
		const v3w = Vector3.TransformCoordinates(v3, worldMatrix);

		// Calculate Center
		const center = v1w.add(v2w).add(v3w).scale(1 / 3);

		// Calculate Normal
		const edge1 = v2w.subtract(v1w);
		const edge2 = v3w.subtract(v1w);
		const normal = Vector3.Cross(edge1, edge2).normalize();

		// Ensure normal points outward from the sphere center
		const meshCenter = mesh.absolutePosition;
		const dirFromCenter = center.subtract(meshCenter);

		if (Vector3.Dot(normal, dirFromCenter) < 0) {
			normal.scaleInPlace(-1);
		}

		return {
			mesh: mesh,
			faceId: faceId,
			vertices:[v1w, v2w, v3w],
			center: center,
			normal: normal
		};
	}

	_handleFaceClick (pickInfo) {
		const faceData = this._getFaceData(pickInfo.pickedMesh, pickInfo.faceId);
		if (!faceData) return;

		// Connect the selected sphere face to the currently selected rod
		this._connectSphereToRod(faceData, this.selectedRod);
	}

	// Helper to calculate rotation quaternion from one vector to another
	_getRotationFromTo (fromVec, toVec) {
		const axis = Vector3.Cross(fromVec, toVec);
		const dot = Vector3.Dot(fromVec, toVec);

		if (dot > 0.9999) {
			return Quaternion.Identity();
		}
		if (dot < -0.9999) {
			// Opposite directions: 180 deg rotation around any orthogonal axis
			let ortho = Vector3.Cross(Vector3.Up(), fromVec);
			if (ortho.lengthSquared() < 0.0001) {
				ortho = Vector3.Cross(Vector3.Right(), fromVec);
			}
			ortho.normalize();
			return Quaternion.RotationAxis(ortho, Math.PI);
		}

		return Quaternion.RotationAxis(axis.normalize(), Math.acos(dot));
	}

	// Helper function to create a 6DoF fixed constraint aligning current orientations
	_createFixedConstraint (meshA, meshB, anchorWorldPos) {
		const invMatrixA = meshA.computeWorldMatrix(true).clone().invert();
		const invMatrixB = meshB.computeWorldMatrix(true).clone().invert();

		const pivotA = Vector3.TransformCoordinates(anchorWorldPos, invMatrixA);
		const pivotB = Vector3.TransformCoordinates(anchorWorldPos, invMatrixB);

		const rotMatrixA = new Matrix();
		meshA.getWorldMatrix().getRotationMatrixToRef(rotMatrixA);
		rotMatrixA.invert();

		const rotMatrixB = new Matrix();
		meshB.getWorldMatrix().getRotationMatrixToRef(rotMatrixB);
		rotMatrixB.invert();

		const axisA = Vector3.TransformNormal(Vector3.Up(), rotMatrixA).normalize();
		const axisB = Vector3.TransformNormal(Vector3.Up(), rotMatrixB).normalize();

		const perpAxisA = Vector3.TransformNormal(Vector3.Right(), rotMatrixA).normalize();
		const perpAxisB = Vector3.TransformNormal(Vector3.Right(), rotMatrixB).normalize();

		return new Physics6DoFConstraint(
			{
				pivotA: pivotA,
				pivotB: pivotB,
				axisA: axisA,
				axisB: axisB,
				perpAxisA: perpAxisA,
				perpAxisB: perpAxisB
			},[
				{ axis: PhysicsConstraintAxis.LINEAR_X, minLimit: 0, maxLimit: 0 },
				{ axis: PhysicsConstraintAxis.LINEAR_Y, minLimit: 0, maxLimit: 0 },
				{ axis: PhysicsConstraintAxis.LINEAR_Z, minLimit: 0, maxLimit: 0 },
				{ axis: PhysicsConstraintAxis.ANGULAR_X, minLimit: 0, maxLimit: 0 },
				{ axis: PhysicsConstraintAxis.ANGULAR_Y, minLimit: 0, maxLimit: 0 },
				{ axis: PhysicsConstraintAxis.ANGULAR_Z, minLimit: 0, maxLimit: 0 }
			],
			this.scene
		);
	}

	// Animates and connects a sphere to a pre-existing rod
	async _connectSphereToRod (faceData, rod) {
		const sphere = faceData.mesh.parent;
		if (!sphere) return;

		// Prevent a sphere from attaching to the same rod twice
		if (rod.metadata.attachedA?.sphere === sphere || rod.metadata.attachedB?.sphere === sphere) {
			console.warn("Sphere already attached to this rod.");
			return;
		}

		// Determine which end of the rod is free and closest to the sphere
		const rodLen = rod.metadata.length;
		const rodWorldMatrix = rod.computeWorldMatrix(true);

		const posA = new Vector3(0, rodLen / 2, 0);
		const posB = new Vector3(0, -rodLen / 2, 0);
		const worldPosA = Vector3.TransformCoordinates(posA, rodWorldMatrix);
		const worldPosB = Vector3.TransformCoordinates(posB, rodWorldMatrix);

		const distA = Vector3.Distance(sphere.absolutePosition, worldPosA);
		const distB = Vector3.Distance(sphere.absolutePosition, worldPosB);

		const isAFree = !rod.metadata.attachedA;
		const isBFree = !rod.metadata.attachedB;

		let endName = null;
		let endLocalPos = null;
		let endLocalNormal = null;

		if (isAFree && isBFree) {
			// Both ends are free, pick the closest one to the sphere
			if (distA <= distB) {
				endName = 'A';
			} else {
				endName = 'B';
			}
		} else if (isAFree) {
			endName = 'A';
		} else if (isBFree) {
			endName = 'B';
		} else {
			console.warn("Rod is fully occupied.");
			return;
		}

		if (endName === 'A') {
			endLocalPos = posA;
			endLocalNormal = new Vector3(0, 1, 0);
		} else {
			endLocalPos = posB;
			endLocalNormal = new Vector3(0, -1, 0);
		}

		// 1. Disable Physics on Both (Lock in place during sequence)
		const bodyS = sphere.physicsBody;
		const bodyR = rod.physicsBody;

		if (bodyS) {
			bodyS.setMotionType(PhysicsMotionType.ANIMATED);
			bodyS.disablePreStep = false; // Ensure physics body physically follows mesh during animation
		}
		if (bodyR) {
			bodyR.setMotionType(PhysicsMotionType.ANIMATED);
			bodyR.disablePreStep = false; // Ensure physics body physically follows mesh during animation
		}

		// 2. Prepare Geometry Data
		const endWorldPos = Vector3.TransformCoordinates(endLocalPos, rodWorldMatrix);
		const endWorldNormal = Vector3.TransformNormal(endLocalNormal, rodWorldMatrix).normalize();

		const faceNormal = faceData.normal;
		const targetFaceNormal = endWorldNormal.scale(-1); // Point inward to the rod

		// Quaternion to rotate face normal to target normal
		const alignmentQuat = this._getRotationFromTo(faceNormal, targetFaceNormal);

		// Target Rotation for Sphere
		const sphereRot = sphere.rotationQuaternion || Quaternion.FromEulerVector(sphere.rotation);
		const targetRot = alignmentQuat.multiply(sphereRot);

		// Target Position for Sphere
		const vSf = faceData.center.subtract(sphere.absolutePosition);
		const vSfNew = new Vector3();
		vSf.rotateByQuaternionToRef(alignmentQuat, vSfNew);
		const targetPos = endWorldPos.subtract(vSfNew);

		// 3. Animate Sphere to the rod
		const frameRate = 60;
		const duration = 60; // 1 second

		const animPos = new Animation("animPos", "position", frameRate, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
		animPos.setKeys([
			{ frame: 0, value: sphere.position.clone() },
			{ frame: duration, value: targetPos }
		]);

		const animRot = new Animation("animRot", "rotationQuaternion", frameRate, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
		if (!sphere.rotationQuaternion) sphere.rotationQuaternion = Quaternion.FromEulerVector(sphere.rotation);
		animRot.setKeys([
			{ frame: 0, value: sphere.rotationQuaternion.clone() },
			{ frame: duration, value: targetRot }
		]);

		sphere.animations =[animPos, animRot];

		await new Promise((resolve) => {
			this.scene.beginAnimation(sphere, 0, duration, false, 1.0, resolve);
		});

		// 4. Create Physics Constraint
		sphere.computeWorldMatrix(true);
		rod.computeWorldMatrix(true);

		const constraint = this._createFixedConstraint(sphere, rod, endWorldPos);
		sphere.physicsBody.addConstraint(rod.physicsBody, constraint);

		// 5. Restore original motion types
		if (bodyS) {
			bodyS.setMotionType(PhysicsMotionType.DYNAMIC);
			bodyS.disablePreStep = true; // Restore performance optimization
		}
		if (bodyR) {
			bodyR.setMotionType(PhysicsMotionType.DYNAMIC);
			bodyR.disablePreStep = true; // Restore performance optimization
		}

		// 6. Store connection data
		rod.metadata['attached' + endName] = {
			sphere: sphere,
			constraint: constraint
		};
	}

	_selectRod (mesh) {
		if (this.selectedRod === mesh) return;

		// Deselect previous
		this._deselectRod();

		this.selectedRod = mesh;
		mesh.material = this.selectedRodMat;
	}

	_deselectRod () {
		if (this.selectedRod) {
			this.selectedRod.material = this.rodMat;
			this.selectedRod = null;
		}
	}

	unlinkSelected () {
		if (!this.selectedRod) return;

		const rod = this.selectedRod;

		// Dispose Constraints cleanly
		if (rod.metadata.attachedA && rod.metadata.attachedA.constraint) {
			rod.metadata.attachedA.constraint.dispose();
		}
		if (rod.metadata.attachedB && rod.metadata.attachedB.constraint) {
			rod.metadata.attachedB.constraint.dispose();
		}

		// Dispose Physics Body cleanly
		if (rod.physicsBody) {
			rod.physicsBody.dispose();
		}

		// Remove Visual Mesh
		rod.dispose();

		// Remove from list
		const index = this.rods.indexOf(rod);
		if (index > -1) {
			this.rods.splice(index, 1);
		}

		this.selectedRod = null;
	}

	setRodLength (len) {
		this.rodLength = len;
	}
}
