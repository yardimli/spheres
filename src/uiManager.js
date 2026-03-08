import { AdvancedDynamicTexture, StackPanel, Slider, TextBlock, Button, Control } from "@babylonjs/gui";

export function createUI(sphereManager, environmentManager) {
	const advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");

	const panel = new StackPanel();
	panel.width = "220px";
	panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	panel.paddingTop = "20px";
	panel.paddingRight = "20px";
	advancedTexture.addControl(panel);

	// Helper to create slider
	const addSlider = (text, min, max, initial, onChange) => {
		const header = new TextBlock();
		header.text = text + ": " + initial;
		header.height = "30px";
		header.color = "white";
		panel.addControl(header);

		const slider = new Slider();
		slider.minimum = min;
		slider.maximum = max;
		slider.value = initial;
		slider.height = "20px";
		slider.width = "200px";
		slider.color = "orange";
		slider.background = "grey";
		slider.onValueChangedObservable.add((value) => {
			// Snap to integer if subdivisions
			if(text === "Subdivisions") value = Math.round(value);
			// Round size for clean display
			if(text.includes("Ground") || text === "Size") value = Math.round(value * 10) / 10;

			header.text = text + ": " + value;
			onChange(value);
		});
		panel.addControl(slider);
		return { slider, header };
	};

	// --- Sphere Controls ---

	// Radius Slider
	const radiusControls = addSlider("Size", 0.5, 5, 2, (value) => {
		if(sphereManager.selectedSphere) {
			sphereManager.updateSelectedSphere(
				value,
				sphereManager.selectedSphere.metadata.subdivisions
			);
		}
	});

	// Subdivisions Slider
	const subControls = addSlider("Subdivisions", 1, 6, 1, (value) => {
		if(sphereManager.selectedSphere) {
			sphereManager.updateSelectedSphere(
				sphereManager.selectedSphere.metadata.radius,
				value
			);
		}
	});

	// Spacer
	const spacer = new TextBlock();
	spacer.height = "20px";
	panel.addControl(spacer);

	// --- Environment Controls ---

	// Ground Width Slider
	addSlider("Ground Width", 20, 200, environmentManager.currentWidth, (value) => {
		environmentManager.updateGroundDimensions(value, environmentManager.currentDepth);
	});

	// Ground Depth Slider
	addSlider("Ground Depth", 20, 200, environmentManager.currentDepth, (value) => {
		environmentManager.updateGroundDimensions(environmentManager.currentWidth, value);
	});

	// Spacer
	const spacerEnvironment = new TextBlock();
	spacerEnvironment.height = "20px";
	panel.addControl(spacerEnvironment);

	// --- Actions ---

	// Spawn Button
	const button = Button.CreateSimpleButton("but1", "Spawn Sphere");
	button.width = "200px";
	button.height = "40px";
	button.color = "white";
	button.cornerRadius = 20;
	button.background = "green";
	button.onPointerUpObservable.add(() => {
		sphereManager.createSphere(Math.random() * 2 + 1, Math.floor(Math.random() * 3) + 1);
	});
	panel.addControl(button);

	// Spacer
	const spacer2 = new TextBlock();
	spacer2.height = "10px";
	panel.addControl(spacer2);

	// Random Kick Button
	const kickButton = Button.CreateSimpleButton("but2", "Kick Selected");
	kickButton.width = "200px";
	kickButton.height = "40px";
	kickButton.color = "white";
	kickButton.cornerRadius = 20;
	kickButton.background = "#DDAA00"; // Gold/Dark Yellow
	kickButton.onPointerUpObservable.add(() => {
		sphereManager.applyRandomVelocity();
	});
	panel.addControl(kickButton);

	// Spacer
	const spacer3 = new TextBlock();
	spacer3.height = "10px";
	panel.addControl(spacer3);

	// Mutation Button
	const mutateButton = Button.CreateSimpleButton("but3", "Mutation");
	mutateButton.width = "200px";
	mutateButton.height = "40px";
	mutateButton.color = "white";
	mutateButton.cornerRadius = 20;
	mutateButton.background = "#AA33AA"; // Purple
	mutateButton.onPointerUpObservable.add(() => {
		sphereManager.mutateSelectedSphere();
	});
	panel.addControl(mutateButton);

	// Update Sliders when Selection Changes
	sphereManager.onSelectionChange = (data) => {
		radiusControls.slider.value = data.radius;
		radiusControls.header.text = "Size: " + data.radius.toFixed(1);

		subControls.slider.value = data.subdivisions;
		subControls.header.text = "Subdivisions: " + data.subdivisions;
	};
}
