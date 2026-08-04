/**
 * Line Item Component
 * Display individual line items from a receipt
 */

import { StyleSheet, View, Text } from 'react-native';
import { LineItem } from '@/types/receipt';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCurrency } from '@/utils/format';

interface LineItemRowProps {
  item: LineItem;
  currency: string;
}

export function LineItemRow({ item, currency }: LineItemRowProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const formattedPrice = formatCurrency(item.price, currency);

  const quantityText =
    item.quantity !== null && item.quantity > 1 ? `x${item.quantity}` : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={styles.nameContainer}>
        <Text
          style={[styles.name, { color: colors.text }]}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        {quantityText ? (
          <Text style={[styles.quantity, { color: colors.icon }]}>
            {quantityText}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.price, { color: colors.text }]}>{formattedPrice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
  nameContainer: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 15,
    fontWeight: '500',
  },
  quantity: {
    fontSize: 13,
    marginTop: 2,
  },
  price: {
    fontSize: 15,
    fontWeight: '600',
  },
});
