import type { SwitchProps } from "./switch";
import { Host, Switch as NativeSwitch } from "@expo/ui";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { accessibilityLabel, labelsHidden, tint } from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
import { haptics } from "./motion";
import { useTheme } from "./theme";

export type { SwitchProps } from "./switch";

export function Switch({ value, onValueChange, label, disabled = false }: SwitchProps) {
	const { colors, scheme, size } = useTheme();
	return (
		<Host
			matchContents
			colorScheme={scheme}
			seedColor={colors.accent}
			style={{ minHeight: size.hit, justifyContent: "center" }}
		>
			<NativeSwitch
				value={value}
				disabled={disabled}
				modifiers={
					Platform.OS === "ios"
						? [labelsHidden(), tint(colors.accent), ...(label ? [accessibilityLabel(label)] : [])]
						: label
							? [semantics({ contentDescription: label })]
							: []
				}
				onValueChange={(next) => {
					haptics.selection();
					onValueChange(next);
				}}
			/>
		</Host>
	);
}
