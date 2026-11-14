// Browser-only gallery: render shipped primitives without loading native PDF/auth routes.
import type { Group } from "../../app/dev/ui";
import { I18nProvider } from "@lingui/react";
import { TrueSheetProvider } from "@lodev09/react-native-true-sheet";
import { registerRootComponent } from "expo";
import { useFonts } from "expo-font";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GalleryContent } from "../../app/dev/ui";
import { i18n, initI18n } from "@/i18n";
import { IconButton, Text, Toaster, WindowSafeAreaProvider, setThemePreference, useTheme } from "@/ui";
import { fontAssets } from "@/ui/fonts";
import { initTheme } from "@/ui/theme";

function Preview() {
	const { colors, scheme, space } = useTheme();
	const [group, setGroup] = useState<Group>("fields");
	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					paddingHorizontal: space.s4,
					paddingVertical: space.s3,
				}}
			>
				<Text variant="heading">Interface preview</Text>
				<IconButton
					icon={scheme === "dark" ? "sun" : "moon"}
					label="Toggle color scheme"
					onPress={() => setThemePreference(scheme === "dark" ? "light" : "dark")}
				/>
			</View>
			<GalleryContent group={group} setGroup={setGroup} />
			<Toaster />
		</View>
	);
}

function App() {
	const [fontsLoaded, fontError] = useFonts(fontAssets);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		initTheme();
		void initI18n().then(() => setReady(true));
	}, []);
	if (!__DEV__ || !ready || (!fontsLoaded && !fontError)) return null;
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<SafeAreaProvider>
				<WindowSafeAreaProvider>
					<KeyboardProvider>
						<I18nProvider i18n={i18n}>
							<TrueSheetProvider>
								<Preview />
							</TrueSheetProvider>
						</I18nProvider>
					</KeyboardProvider>
				</WindowSafeAreaProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}

registerRootComponent(App);
