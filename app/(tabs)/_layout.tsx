import { Map } from 'lucide-react-native';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { display: 'none' },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Rido',
          tabBarIcon: () => <Map size={20} color="#2563eb" />,
        }}
      />
    </Tabs>
  );
}
