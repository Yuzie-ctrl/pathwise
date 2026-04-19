import { List } from 'lucide-react-native';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Index',
          tabBarIcon: () => <List className="text-foreground" />,
        }}
      />
    </Tabs>
  );
}
