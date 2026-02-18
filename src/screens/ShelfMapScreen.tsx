import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAllOccupancy, getShelfItems } from '../database/shelves';
import { ShelfOccupancy, ShelfItem, LEVEL_LABELS } from '../types';
import ShelfGrid from '../components/ShelfGrid';
import SyncBanner from '../components/SyncBanner';
import { colors, shelfColors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

export default function ShelfMapScreen() {
  const [occupancy, setOccupancy] = useState<ShelfOccupancy[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);

  const loadData = useCallback(async () => {
    const occ = await getAllOccupancy();
    setOccupancy(occ);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleShelfPress = async (shelfId: string) => {
    setSelectedShelf(shelfId);
    const items = await getShelfItems(shelfId);
    setShelfItems(items);
    setDetailVisible(true);
  };

  const occ = occupancy.find((o) => o.shelf_id === selectedShelf);

  return (
    <View style={styles.container}>
      <SyncBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.title}>Shelf Map</Text>
        <Text style={styles.subtitle}>Tap a shelf to see its contents</Text>

        {occupancy.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>No shelves recorded yet</Text>
          </View>
        ) : (
          <>
            <ShelfGrid occupancy={occupancy} side="A" onShelfPress={handleShelfPress} />
            <ShelfGrid occupancy={occupancy} side="B" onShelfPress={handleShelfPress} />
          </>
        )}

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: shelfColors.empty }]} />
            <Text style={styles.legendText}>Empty (0)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: shelfColors.partial }]} />
            <Text style={styles.legendText}>Partial (1-2)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: shelfColors.full }]} />
            <Text style={styles.legendText}>Full (3+)</Text>
          </View>
        </View>
      </ScrollView>

      {/* Shelf Detail Modal */}
      <Modal
        visible={detailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <View style={styles.modalShelfRow}>
                  <Ionicons name="cube" size={20} color={colors.primary} />
                  <Text style={styles.modalShelfId}>{selectedShelf}</Text>
                </View>
                {occ && (
                  <Text style={styles.modalLocation}>
                    Side {occ.side} | Shelf {occ.position} | {LEVEL_LABELS[occ.level] ?? occ.level}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setDetailVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSectionTitle}>
              Buckets ({shelfItems.length})
            </Text>

            {shelfItems.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Text style={styles.modalEmptyText}>This shelf is empty</Text>
              </View>
            ) : (
              <FlatList
                data={shelfItems}
                keyExtractor={(item) => item.bucket_id}
                renderItem={({ item }) => (
                  <View style={styles.itemRow}>
                    <View style={styles.itemMain}>
                      <Text style={styles.itemBucket}>{item.bucket_id}</Text>
                      <View style={styles.itemDetails}>
                        {item.variety ? <Text style={styles.itemDetail}>{item.variety}</Text> : null}
                        {item.stem_qty > 0 ? (
                          <Text style={styles.itemDetail}>{item.stem_qty} stems</Text>
                        ) : null}
                        {item.stem_length ? (
                          <Text style={styles.itemDetail}>{item.stem_length}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.itemDate}>
                        Added: {new Date(item.date_added).toLocaleString()}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.syncDot,
                        { backgroundColor: item.synced ? colors.success : colors.warning },
                      ]}
                    />
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadow.sm,
  },
  emptyText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
    gap: spacing.xl,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  legendText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.xl,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  modalShelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalShelfId: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.primary,
  },
  modalLocation: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalCloseButton: {
    padding: spacing.sm,
  },
  modalSectionTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  modalEmpty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemMain: {
    flex: 1,
  },
  itemBucket: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  itemDetails: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 2,
  },
  itemDetail: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  itemDate: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  syncDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: spacing.sm,
  },
});
