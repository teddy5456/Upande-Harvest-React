import React, { useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import {
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { AppProvider, useApp } from './src/context/AppContext';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import HarvestScreen from './src/screens/HarvestScreen';
import ReceivingScreen from './src/screens/ReceivingScreen';
import ShelveScreen from './src/screens/ShelveScreen';
import GradeScreen from './src/screens/GradeScreen';
import ShelfMapScreen from './src/screens/ShelfMapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import DrawerMenu from './src/components/DrawerContent';
import { colors, fontFamily, fontSize, spacing } from './src/theme';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { outline: 'home-outline', filled: 'home' },
  Harvest: { outline: 'leaf-outline', filled: 'leaf' },
  Receive: { outline: 'download-outline', filled: 'download' },
  Shelve: { outline: 'scan-outline', filled: 'scan' },
  Grade: { outline: 'clipboard-outline', filled: 'clipboard' },
};

function AppContent() {
  const { isReady, isLoggedIn } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigationRef = React.useRef<any>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handleNavigate = useCallback((tab: string) => {
    navigationRef.current?.navigate(tab);
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <>
        <LoginScreen />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: {
            backgroundColor: colors.surface,
            elevation: 0,
            shadowOpacity: 0,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontFamily: fontFamily.semiBold,
            fontSize: fontSize.lg,
          },
          headerLeft: () => (
            <TouchableOpacity
              onPress={openDrawer}
              style={{ marginLeft: spacing.lg }}
              activeOpacity={0.7}
            >
              <Ionicons name="menu-outline" size={24} color={colors.text} />
            </TouchableOpacity>
          ),
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 52,
          },
          tabBarIcon: ({ focused, size }) => {
            const icons = TAB_ICONS[route.name];
            const iconName = focused ? icons?.filled : icons?.outline;
            return (
              <Ionicons
                name={iconName ?? 'help-outline'}
                size={size}
                color={focused ? colors.text : colors.textMuted}
              />
            );
          },
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
        <Tab.Screen name="Harvest" component={HarvestScreen} options={{ title: 'Harvest' }} />
        <Tab.Screen name="Receive" component={ReceivingScreen} options={{ title: 'Receiving' }} />
        <Tab.Screen name="Shelve" component={ShelveScreen} options={{ title: 'Shelve' }} />
        <Tab.Screen name="Grade" component={GradeScreen} options={{ title: 'Grade' }} />
        <Tab.Screen name="Map" component={ShelfMapScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Shelf Map' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Settings' }} />
      </Tab.Navigator>

      <DrawerMenu
        visible={drawerOpen}
        onClose={closeDrawer}
        onNavigate={handleNavigate}
      />

      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
