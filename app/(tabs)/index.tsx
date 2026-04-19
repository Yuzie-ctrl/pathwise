import { Stack } from 'expo-router';
import { View, Text } from 'react-native';

export default function Home() {
  return <ScreenContent />;
}

function ScreenContent() {
  return (
    <View className="flex flex-col basis-full bg-background p-8">
      <Stack.Screen
        options={{
          title: 'Home',
        }}
      />
      <View className="flex-1 items-center justify-center">
        <Text className="text-2xl font-bold text-center mb-4">
          Welcome to Your App
        </Text>
        <Text className="text-base text-center text-muted-foreground">
          This is your starting point. Start building something amazing!
        </Text>
      </View>
    </View>
  );
}
