import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { RequestActionButton } from "./RequestActionButton";

/** Replaces the composer on a retired Pivot, which is read-only history. */
export function RetiredPivotBar(props: { readonly onOpenSuccessor: (() => void) | null }) {
  return (
    <View className="flex-row items-center gap-3 rounded-[20px] border border-border-subtle bg-card-alt py-2 pe-2 ps-4">
      <Text className="min-w-0 flex-1 font-sans text-sm text-foreground-secondary">
        This Pivot is retired. Its live work moved to the Pivot that took over.
      </Text>
      {props.onOpenSuccessor ? (
        <RequestActionButton
          label="Open the active Pivot"
          tone="secondary"
          onPress={props.onOpenSuccessor}
        />
      ) : null}
    </View>
  );
}
