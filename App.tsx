import React, { useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import ReceivingOutScreen from './src/screens/ReceivingOutScreen';
import IssuingScreen from './src/screens/IssuingScreen';
import GradeScreen from './src/screens/GradeScreen';
import PackingScreen from './src/screens/PackingScreen';
import XfloraPackingScreen from './src/screens/XfloraPackingScreen';
import DispatchScreen from './src/screens/DispatchScreen';
import LongStorageScreen from './src/screens/LongStorageScreen';
import ChatScreen from './src/screens/ChatScreen';
import SupportFab, { useSupport } from './src/components/SupportFab';
import StaleConnectionBanner from './src/components/StaleConnectionBanner';
import TransferScreen from './src/screens/TransferScreen';
import QualityScreen from './src/screens/QualityScreen';
import ShelfMapScreen from './src/screens/ShelfMapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ActualHarvestScreen from './src/screens/ActualHarvestScreen';
import AgricultureScreen from './src/screens/AgricultureScreen';
import ProductionPlanScreen from './src/screens/agriculture/ProductionPlanScreen';
import BedSamplingScreen from './src/screens/agriculture/BedSamplingScreen';
import TasksScreen from './src/screens/agriculture/TasksScreen';
import UprootReplantScreen from './src/screens/agriculture/UprootReplantScreen';
import SeedlingsScreen from './src/screens/agriculture/SeedlingsScreen';
import CropCycleViewScreen from './src/screens/agriculture/CropCycleViewScreen';
import DrawerMenu from './src/components/DrawerContent';
import UpdatePrompt from './src/components/UpdatePrompt';
import ChangelogModal from './src/components/ChangelogModal';
import TutorialModal from './src/components/TutorialModal';
import { colors, fontFamily, fontSize, spacing } from './src/theme';

const Tab = createBottomTabNavigator();
const AgricultureStack = createNativeStackNavigator();

function AgricultureNavigator() {
  return (
    <AgricultureStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg },
        headerShadowVisible: false,
      }}
    >
      <AgricultureStack.Screen
        name="AgricultureHome"
        component={AgricultureScreen}
        options={{ headerShown: false }}
      />
      <AgricultureStack.Screen
        name="ProductionPlan"
        component={ProductionPlanScreen}
        options={{ title: 'Production Plan' }}
      />
      <AgricultureStack.Screen
        name="BedSampling"
        component={BedSamplingScreen}
        options={{ title: 'Bed Sampling' }}
      />
      <AgricultureStack.Screen
        name="Tasks"
        component={TasksScreen}
        options={{ title: 'Tasks' }}
      />
      <AgricultureStack.Screen
        name="UprootReplant"
        component={UprootReplantScreen}
        options={{ title: 'Uproot / Replant' }}
      />
      <AgricultureStack.Screen
        name="Seedlings"
        component={SeedlingsScreen}
        options={{ title: 'Seedlings' }}
      />
      <AgricultureStack.Screen
        name="CropCycleView"
        component={CropCycleViewScreen}
        options={{ title: 'Crop Cycles' }}
      />
    </AgricultureStack.Navigator>
  );
}

/**
 * Top-right "Contact support" button rendered in every screen's header.
 * Calls into the SupportFab context to open the modal. Must be mounted INSIDE
 * the SupportFab provider — which the entire Tab.Navigator is wrapped in.
 */
function HeaderSupportButton() {
  const { open } = useSupport();
  return (
    <TouchableOpacity
      onPress={open}
      style={{ marginRight: spacing.lg, padding: 4 }}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel="Contact support"
      accessibilityRole="button"
    >
      <Ionicons name="headset-outline" size={22} color={colors.text} />
    </TouchableOpacity>
  );
}

const TAB_ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  Dashboard: { outline: 'home-outline', filled: 'home' },
  Harvest: { outline: 'leaf-outline', filled: 'leaf' },
  Receive: { outline: 'download-outline', filled: 'download' },
  Transfer: { outline: 'swap-horizontal-outline', filled: 'swap-horizontal' },
  Shelve: { outline: 'scan-outline', filled: 'scan' },
  ReceivingOut: { outline: 'paper-plane-outline', filled: 'paper-plane' },
  Issuing: { outline: 'cart-outline', filled: 'cart' },
  Grade: { outline: 'clipboard-outline', filled: 'clipboard' },
  Pack: { outline: 'cube-outline', filled: 'cube' },
  Quality: { outline: 'shield-checkmark-outline', filled: 'shield-checkmark' },
  ActualHarvest: { outline: 'analytics-outline', filled: 'analytics' },
  Agriculture: { outline: 'flower-outline', filled: 'flower' },
};

function AppContent() {
  const { isReady, isLoggedIn, isXflora, storageMode } = useApp();
  const isDirectToGrader = storageMode === 'Direct-to-Grader';
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
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
      <SupportFab>
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
          headerRight: () => <HeaderSupportButton />,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 52 + insets.bottom,
            paddingBottom: insets.bottom,
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
        <Tab.Screen name="Harvest" component={HarvestScreen} options={{ title: 'Harvest', tabBarItemStyle: isXflora ? { display: 'none' } : undefined }} />
        <Tab.Screen name="Receive" component={ReceivingScreen} options={{ title: 'Receiving' }} />
        <Tab.Screen name="Transfer" component={TransferScreen} options={{ tabBarItemStyle: isXflora ? undefined : { display: 'none' }, title: 'Transfer' }} />
        {/* Shelve is reachable via the drawer; hidden from the bottom nav. */}
        <Tab.Screen
          name="Shelve"
          component={ShelveScreen}
          options={{ title: 'Shelve', tabBarItemStyle: { display: 'none' } }}
        />
        {/* Receiving Out is now the bucket↔grader binding for ALL modes. */}
        <Tab.Screen
          name="ReceivingOut"
          component={ReceivingOutScreen}
          options={{ title: 'Receiving Out' }}
        />
        <Tab.Screen name="Grade" component={GradeScreen} options={{ title: 'Grade' }} />
        <Tab.Screen name="Pack" component={isXflora ? XfloraPackingScreen : PackingScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Packing' }} />
        <Tab.Screen name="LongStorage" component={LongStorageScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Long Storage' }} />
        <Tab.Screen name="Chat" component={ChatScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Chat' }} />
        <Tab.Screen name="Dispatch" component={DispatchScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Dispatch' }} />
        <Tab.Screen name="Issuing" component={IssuingScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Issuing' }} />
        <Tab.Screen name="Quality" component={QualityScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Quality' }} />
        <Tab.Screen name="Map" component={ShelfMapScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Shelf Map' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Settings' }} />
        <Tab.Screen name="ActualHarvest" component={ActualHarvestScreen} options={{ tabBarItemStyle: { display: 'none' }, title: 'Actual Harvest' }} />
        <Tab.Screen
          name="Agriculture"
          component={AgricultureNavigator}
          options={{
            tabBarItemStyle: isXflora ? { display: 'none' } : undefined,
            headerShown: false,
            title: 'Agriculture',
          }}
        />
      </Tab.Navigator>
      </SupportFab>

      <StaleConnectionBanner />

      <DrawerMenu
        visible={drawerOpen}
        onClose={closeDrawer}
        onNavigate={handleNavigate}
        onWhatsNew={() => { closeDrawer(); setTimeout(() => setChangelogOpen(true), 250); }}
        onTutorial={() => { closeDrawer(); setTimeout(() => setTutorialOpen(true), 250); }}
      />

      <ChangelogModal
        forceVisible={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />

      <TutorialModal
        visible={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
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
        <UpdatePrompt />
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
