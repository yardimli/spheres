import { AdvancedDynamicTexture, StackPanel, Slider, TextBlock, Button, Control } from "@babylonjs/gui";

export function createUI(sphereManager) {
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

			header.text = text + ": " + value.toFixed(1);
			onChange(value);
		});
		panel.addControl(slider);
		return { slider, header };
	};

	// --- Controls ---

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

	// Update Sliders when Selection Changes
	sphereManager.onSelectionChange = (data) => {
		radiusControls.slider.value = data.radius;
		radiusControls.header.text = "Size: " + data.radius.toFixed(1);

		subControls.slider.value = data.subdivisions;
		subControls.header.text = "Subdivisions: " + data.subdivisions;
	};
}
