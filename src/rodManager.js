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
	ActionManager,
	ExecuteCodeAction,
	Scalar,
	Mesh,
	VertexData
} from "@babylonjs/core";

export class RodManager {
	constructor(scene, sphereManager) {
		this.scene = scene;
		this.sphereManager = sphereManager;

		// Configuration
		this.rodLength = 10; // Default length
		this.rodWallThickness = 0.2;
		this.rodDiameter = 1;

		// State
		this.selectedFace = null; // { mesh, faceId, normal, center }
		this.selectionMesh = null; // Selected face mesh (pulsing)
		this.selectedRod = null;
		this.rods = []; // Store active rods

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

	_initInteraction() {
		// Click Logic
		this.scene.onPointerDown = (evt, pickInfo) => {
			if (evt.button !== 0) return; // Left click only

			// Check if we clicked a Rod
			if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name === "connectionRod") {
				this._selectRod(pickInfo.pickedMesh);
				// Clear face selection when selecting a rod
				this._clearFaceSelection();
				return;
			}

			// Check if we clicked a Core Face
			if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name === "core") {
				this._handleFaceClick(pickInfo);
				return;
			}

			// Clicked elsewhere
			this._deselectRod();
			this._clearFaceSelection();
		};
	}

	_getFaceData(mesh, faceId) {
		const indices = mesh.getIndices();
		const positions = mesh.getVerticesData("position");

		if (!indices || !positions) return null;

		// A face in a standard mesh usually consists of 3 indices (triangle)
		// Note: pickInfo.faceId is the index of the face (triangle index), so we multiply by 3
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
		const center = v1w.add(v2w).add(v3w).scale(1/3);

		// Calculate Normal
		const edge1 = v2w.subtract(v1w);
		const edge2 = v3w.subtract(v1w);
		let normal = Vector3.Cross(edge1, edge2).normalize();

		// FIX: Ensure normal points outward from the sphere center
		// The core mesh's parent is the sphere, so the sphere center is the parent's position
		// Or simply, the core's absolute position is the center (since it's centered in the sphere)
		const meshCenter = mesh.absolutePosition;
		const dirFromCenter = center.subtract(meshCenter);

		if (Vector3.Dot(normal, dirFromCenter) < 0) {
			normal.scaleInPlace(-1);
		}

		return {
			mesh: mesh,
			faceId: faceId,
			vertices: [v1w, v2w, v3w],
			center: center,
			normal: normal
		};
	}

	_handleFaceClick(pickInfo) {
		const faceData = this._getFaceData(pickInfo.pickedMesh, pickInfo.faceId);
		if (!faceData) return;

		// Case 1: Deselect if clicking the same face
		if (this.selectedFace &&
			this.selectedFace.mesh === faceData.mesh &&
			this.selectedFace.faceId === faceData.faceId) {
			this._clearFaceSelection();
			return;
		}

		// Case 2: First selection
		if (!this.selectedFace) {
			this.selectedFace = faceData;

			// Create Pulsing Face Mesh
			this._createPulsingSelection(faceData);

			return;
		}

		// Case 3: Second selection (different mesh)
		if (this.selectedFace.mesh !== faceData.mesh) {
			// Prevent connecting a sphere to itself
			if (this.selectedFace.mesh.parent === faceData.mesh.parent) {
				console.warn("Cannot connect a sphere to itself.");
				this._clearFaceSelection();
				return;
			}

			// Connect!
			this._connectSpheres(this.selectedFace, faceData);
			this._clearFaceSelection();
		}
	}

	_createPulsingSelection(faceData) {
		// We need local coordinates to parent the selection mesh to the core
		const mesh = faceData.mesh;
		const indices = mesh.getIndices();
		const positions = mesh.getVerticesData("position");

		const i1 = indices[faceData.faceId * 3];
		const i2 = indices[faceData.faceId * 3 + 1];
		const i3 = indices[faceData.faceId * 3 + 2];

		const v1 = Vector3.FromArray(positions, i1 * 3);
		const v2 = Vector3.FromArray(positions, i2 * 3);
		const v3 = Vector3.FromArray(positions, i3 * 3);

		// Create custom mesh for the face
		const customMesh = new Mesh("selectedFace", this.scene);
		const vertexData = new VertexData();
		vertexData.positions = [...v1.asArray(), ...v2.asArray(), ...v3.asArray()];
		vertexData.indices = [0, 1, 2];

		// Calculate normal for this single face
		const normal = Vector3.Cross(v2.subtract(v1), v3.subtract(v1)).normalize();

		// Ensure visual normal matches logical normal (outward)
		// We use the same logic as _getFaceData but in local space
		// Local center is (0,0,0) for the core
		const localCenter = v1.add(v2).add(v3).scale(1/3);
		if (Vector3.Dot(normal, localCenter) < 0) {
			// Flip winding order for visual mesh if needed, or just flip normal
			// For rendering, we want the face to face out.
			vertexData.indices = [0, 2, 1]; // Flip indices
			normal.scaleInPlace(-1);
		}

		vertexData.normals = [...normal.asArray(), ...normal.asArray(), ...normal.asArray()];

		vertexData.applyToMesh(customMesh);

		// Parent to the core
		customMesh.parent = mesh;

		// Material
		const mat = new StandardMaterial("pulsingMat", this.scene);
		mat.diffuseColor = Color3.Green();
		mat.emissiveColor = Color3.Teal();
		mat.alpha = 0.5;
		mat.backFaceCulling = false;
		mat.zOffset = -2; // Ensure it renders on top of the core
		mat.disableLighting = true;
		customMesh.material = mat;
		customMesh.isPickable = false;

		// Animation (Pulse Alpha)
		const anim = new Animation("pulse", "material.alpha", 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
		const keys = [
			{ frame: 0, value: 0.3 },
			{ frame: 30, value: 0.8 },
			{ frame: 60, value: 0.3 }
		];
		anim.setKeys(keys);
		customMesh.animations = [anim];
		this.scene.beginAnimation(customMesh, 0, 60, true);

		this.selectionMesh = customMesh;
	}

	_clearFaceSelection() {
		this.selectedFace = null;
		if (this.selectionMesh) {
			this.selectionMesh.dispose();
			this.selectionMesh = null;
		}
	}

	// Helper to calculate rotation quaternion from one vector to another
	_getRotationFromTo(fromVec, toVec) {
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

	async _connectSpheres(faceA, faceB) {
		const sphereA = faceA.mesh.parent;
		const sphereB = faceB.mesh.parent;

		if (!sphereA || !sphereB) return;

		// 1. Disable Physics on Sphere B (the one that moves)
		const bodyB = sphereB.physicsBody;
		if (bodyB) {
			bodyB.setMotionType(PhysicsMotionType.ANIMATED); // Kinematic for animation
		}

		// 2. Calculate Target Position and Rotation for Sphere B
		const posA = sphereA.absolutePosition;
		const normalA = faceA.normal; // Normalized direction out of A

		// Distance from Sphere Center to Face Center
		const distA = Vector3.Distance(posA, faceA.center);
		const distB = Vector3.Distance(sphereB.absolutePosition, faceB.center);

		// Total distance between sphere centers
		const totalDistance = distA + this.rodLength + distB;

		// Position B along the normal extending from A
		const targetPosB = posA.add(normalA.scale(totalDistance));

		// Target Rotation
		const worldMatrixB = sphereB.computeWorldMatrix(true);
		const rotationMatrixB = new Matrix();
		worldMatrixB.getRotationMatrixToRef(rotationMatrixB);
		const rotationB = Quaternion.FromRotationMatrix(rotationMatrixB);

		const normalB = faceB.normal;
		const targetNormalB = normalA.scale(-1); // Point back towards A

		// Quaternion to rotate NormalB to TargetNormalB
		const alignmentQuat = this._getRotationFromTo(normalB, targetNormalB);

		// Apply this rotation to the current rotation of Sphere B
		const targetRotB = alignmentQuat.multiply(rotationB);

		// 3. Animate Sphere B
		const frameRate = 60;
		const duration = 60; // 1 second

		const animPos = new Animation("animPos", "position", frameRate, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
		const keysPos = [
			{ frame: 0, value: sphereB.position.clone() },
			{ frame: duration, value: targetPosB }
		];
		animPos.setKeys(keysPos);

		const animRot = new Animation("animRot", "rotationQuaternion", frameRate, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
		// Ensure sphereB has a quaternion
		if (!sphereB.rotationQuaternion) sphereB.rotationQuaternion = Quaternion.FromEulerVector(sphereB.rotation);

		const keysRot = [
			{ frame: 0, value: sphereB.rotationQuaternion.clone() },
			{ frame: duration, value: targetRotB }
		];
		animRot.setKeys(keysRot);

		sphereB.animations = [animPos, animRot];

		return new Promise((resolve) => {
			this.scene.beginAnimation(sphereB, 0, duration, false, 1.0, () => {
				// Animation Complete

				// 4. Create Rod Mesh
				// Pass sphereA explicitly as parent, because this.selectedFace is cleared
				const rod = this._createRodMesh(faceA.center, this.rodLength, normalA, sphereA);

				// 5. Physics Constraint (Lock)
				if (sphereA.physicsBody && sphereB.physicsBody) {
					// Reset B to Dynamic
					bodyB.setMotionType(PhysicsMotionType.DYNAMIC);

					// Create Lock Constraint
					const constraint = new Physics6DoFConstraint(
						{
							pivotA: Vector3.Zero(),
							pivotB: Vector3.Zero(),
						},
						[
							{ axis: PhysicsConstraintAxis.LINEAR_X, minLimit: 0, maxLimit: 0 },
							{ axis: PhysicsConstraintAxis.LINEAR_Y, minLimit: 0, maxLimit: 0 },
							{ axis: PhysicsConstraintAxis.LINEAR_Z, minLimit: 0, maxLimit: 0 },
							{ axis: PhysicsConstraintAxis.ANGULAR_X, minLimit: 0, maxLimit: 0 },
							{ axis: PhysicsConstraintAxis.ANGULAR_Y, minLimit: 0, maxLimit: 0 },
							{ axis: PhysicsConstraintAxis.ANGULAR_Z, minLimit: 0, maxLimit: 0 },
						],
						this.scene
					);

					sphereA.physicsBody.addConstraint(sphereB.physicsBody, constraint);

					// Store connection data
					const connection = {
						mesh: rod,
						constraint: constraint,
						sphereA: sphereA,
						sphereB: sphereB
					};

					rod.metadata = { connection: connection };
					this.rods.push(connection);
				}

				resolve();
			});
		});
	}

	_createRodMesh(startPoint, length, direction, parentMesh) {
		// Create a hollow cylinder using a Lathe
		const outerRadius = this.rodDiameter / 2;
		const innerRadius = outerRadius - this.rodWallThickness;

		const shape = [
			new Vector3(innerRadius, 0, 0),
			new Vector3(outerRadius, 0, 0),
			new Vector3(outerRadius, length, 0),
			new Vector3(innerRadius, length, 0),
			new Vector3(innerRadius, 0, 0)
		];

		const rod = MeshBuilder.CreateLathe("connectionRod", {
			shape: shape,
			radius: 1,
			tessellation: 24,
			sideOrientation: 2 // DOUBLESIDE
		}, this.scene);

		// Position and Orient the rod
		rod.position = startPoint;

		// Default Up is (0,1,0). We want to rotate to 'direction'.
		const up = new Vector3(0, 1, 0);
		const quat = this._getRotationFromTo(up, direction);
		rod.rotationQuaternion = quat;

		rod.material = this.rodMat;
		rod.isPickable = true;

		// Animation: Grow from 0 length (scale Y)
		rod.scaling.y = 0.01;

		const animScale = new Animation("growRod", "scaling.y", 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
		const keys = [
			{ frame: 0, value: 0.01 },
			{ frame: 30, value: 1.0 }
		];
		animScale.setKeys(keys);
		rod.animations = [animScale];
		this.scene.beginAnimation(rod, 0, 30, false);

		// Parent the rod to the sphere
		if (parentMesh) {
			rod.setParent(parentMesh);
		}

		return rod;
	}

	_selectRod(mesh) {
		if (this.selectedRod === mesh) return;

		// Deselect previous
		this._deselectRod();

		this.selectedRod = mesh;
		mesh.material = this.selectedRodMat;
	}

	_deselectRod() {
		if (this.selectedRod) {
			this.selectedRod.material = this.rodMat;
			this.selectedRod = null;
		}
	}

	unlinkSelected() {
		if (!this.selectedRod) return;

		const connection = this.selectedRod.metadata.connection;

		// Remove Constraint
		if (connection.constraint) {
			connection.constraint.dispose();
		}

		// Remove Mesh
		if (connection.mesh) {
			connection.mesh.dispose();
		}

		// Remove from list
		const index = this.rods.indexOf(connection);
		if (index > -1) {
			this.rods.splice(index, 1);
		}

		this.selectedRod = null;
	}

	setRodLength(len) {
		this.rodLength = len;
	}
}
