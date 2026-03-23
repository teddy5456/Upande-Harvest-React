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
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { getAllOccupancy, getShelfItems } from '../database/shelves';
import { fetchShelvesDashboard } from '../services/api';
import { ShelfOccupancy, ShelfItem, LEVEL_LABELS } from '../types';
import { parseShelfId } from '../utils/shelf-utils';
import ShelfGrid from '../components/ShelfGrid';
import SyncBanner from '../components/SyncBanner';
import { colors, shelfColors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

interface ERPShelfItem {
  shelf_id: string;
  variety: string;
  item_code: string;
  stem_length: string;
  stem_qty: number;
  greenhouse: string;
  date_added: string | null;
  age_days: number | null;
  bucket_id: string;
}

export default function ShelfMapScreen() {
  const { isConnected } = useApp();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [occupancy, setOccupancy] = useState<ShelfOccupancy[]>([]);
  const [erpItems, setErpItems] = useState<ERPShelfItem[]>([]);
  const [erpStats, setErpStats] = useState<{
    total_items: number;
    total_stems: number;
    variety_count: number;
    avg_age: number;
    oldest_age: number;
  } | null>(null);
  const [dataSource, setDataSource] = useState<'erp' | 'local'>('local');

  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);
  const [erpShelfItems, setErpShelfItems] = useState<ERPShelfItem[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);

  const loadData = useCallback(async () => {
    // Always load local data first
    const localOcc = await getAllOccupancy();

    if (isConnected) {
      try {
        const erp = await fetchShelvesDashboard();
        // Build occupancy from ERP shelf_utilization
        const erpOcc: ShelfOccupancy[] = (erp.shelf_utilization ?? [])
          .map((s: any) => {
            const parsed = parseShelfId(s.shelf_id);
            if (!parsed) return null;
            return {
              shelf_id: s.shelf_id,
              side: parsed.side,
              position: parsed.position,
              level: parsed.level,
              bucket_count: s.items ?? 0,
            };
          })
          .filter(Boolean) as ShelfOccupancy[];

        // Merge: ERP takes priority, local fills gaps for unsynced items
        const merged = mergeOccupancy(erpOcc, localOcc);
        setOccupancy(merged.length > 0 ? merged : localOcc);
        setErpItems(erp.shelf_items ?? []);
        setErpStats({
          total_items: erp.total_items ?? 0,
          total_stems: erp.total_stems ?? 0,
          variety_count: erp.variety_count ?? 0,
          avg_age: erp.avg_age ?? 0,
          oldest_age: erp.oldest_age ?? 0,
        });
        setDataSource('erp');
        return;
      } catch {
        // fall through to local
      }
    }

    setOccupancy(localOcc);
    setErpItems([]);
    setErpStats(null);
    setDataSource('local');
  }, [isConnected]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData().finally(() => setLoading(false));
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleShelfPress = async (shelfId: string) => {
    setSelectedShelf(shelfId);

    if (dataSource === 'erp' && erpItems.length > 0) {
      const filtered = erpItems.filter((i) => i.shelf_id === shelfId);
      setErpShelfItems(filtered);
      setShelfItems([]);
    } else {
      const items = await getShelfItems(shelfId);
      setShelfItems(items);
      setErpShelfItems([]);
    }

    setDetailVisible(true);
  };

  const occ = occupancy.find((o) => o.shelf_id === selectedShelf);

  // Distinct positions found in occupancy (to handle dynamic sizes)
  const sidesWithData = ['A', 'B'].filter((side) =>
    occupancy.some((o) => o.side === side)
  );

  const displayItems = erpShelfItems.length > 0 ? erpShelfItems : null;
  const localDisplayItems = shelfItems;
  const totalBuckets = displayItems ? displayItems.length : localDisplayItems.length;

  return (
    <View style={styles.container}>
      <SyncBanner />
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />
          }
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Shelf Map</Text>
              <Text style={styles.subtitle}>Tap a shelf to see contents</Text>
            </View>
            <View style={[styles.sourcePill, dataSource === 'erp' ? styles.pillLive : styles.pillLocal]}>
              <Text style={[styles.sourcePillText, dataSource === 'erp' ? styles.pillTextLive : styles.pillTextLocal]}>
                {dataSource === 'erp' ? '● Live' : '◌ Local'}
              </Text>
            </View>
          </View>

          {/* ERP Summary Stats */}
          {erpStats && (
            <View style={styles.statsGrid}>
              <StatBox value={erpStats.total_items} label="Buckets" icon="cube-outline" />
              <StatBox value={erpStats.total_stems.toLocaleString()} label="Stems" icon="leaf-outline" />
              <StatBox value={erpStats.variety_count} label="Varieties" icon="flower-outline" />
              <StatBox value={`${erpStats.avg_age}d`} label="Avg Age" icon="time-outline" warn={erpStats.avg_age > 5} />
            </View>
          )}

          {occupancy.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="cube-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No shelf data yet</Text>
              <Text style={styles.emptyHint}>
                {isConnected ? 'Pull to refresh' : 'Scan shelves to populate map'}
              </Text>
            </View>
          ) : (
            <>
              {sidesWithData.length > 0
                ? sidesWithData.map((side) => (
                    <ShelfGrid
                      key={side}
                      occupancy={occupancy}
                      side={side}
                      onShelfPress={handleShelfPress}
                    />
                  ))
                : ['A', 'B'].map((side) => (
                    <ShelfGrid
                      key={side}
                      occupancy={occupancy}
                      side={side}
                      onShelfPress={handleShelfPress}
                    />
                  ))}
            </>
          )}

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: shelfColors.empty }]} />
              <Text style={styles.legendText}>Empty</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: shelfColors.partial }]} />
              <Text style={styles.legendText}>Partial (1–2)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: shelfColors.full }]} />
              <Text style={styles.legendText}>Full (3+)</Text>
            </View>
          </View>

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}

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
                  <Ionicons name="cube" size={20} color={colors.text} />
                  <Text style={styles.modalShelfId}>{selectedShelf}</Text>
                </View>
                {occ && (
                  <Text style={styles.modalLocation}>
                    Side {occ.side} · Shelf {occ.position} · {LEVEL_LABELS[occ.level] ?? occ.level}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setDetailVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSectionTitle}>
              Buckets ({totalBuckets})
            </Text>

            {totalBuckets === 0 ? (
              <View style={styles.modalEmpty}>
                <Text style={styles.modalEmptyText}>Shelf is empty</Text>
              </View>
            ) : displayItems ? (
              // ERP items — richer data
              <FlatList
                data={displayItems}
                keyExtractor={(item) => item.bucket_id}
                renderItem={({ item }) => (
                  <View style={styles.itemRow}>
                    <View style={styles.itemMain}>
                      <View style={styles.itemTopRow}>
                        <Text style={styles.itemBucket}>{item.bucket_id}</Text>
                        {item.age_days !== null && (
                          <View style={[styles.ageBadge, item.age_days > 5 && styles.ageBadgeWarn]}>
                            <Text style={[styles.ageText, item.age_days > 5 && styles.ageTextWarn]}>
                              {item.age_days}d
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.itemDetails}>
                        {item.variety ? <Text style={styles.itemDetail}>{item.variety}</Text> : null}
                        {item.stem_qty > 0 ? <Text style={styles.itemDetail}>{item.stem_qty} stems</Text> : null}
                        {item.stem_length ? <Text style={styles.itemDetail}>{item.stem_length}</Text> : null}
                      </View>
                      {item.greenhouse ? (
                        <Text style={styles.itemSubline}>{item.greenhouse}</Text>
                      ) : null}
                    </View>
                  </View>
                )}
              />
            ) : (
              // Local items
              <FlatList
                data={localDisplayItems}
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
                        {new Date(item.date_added).toLocaleString()}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeOccupancy(erp: ShelfOccupancy[], local: ShelfOccupancy[]): ShelfOccupancy[] {
  const map: Record<string, ShelfOccupancy> = {};
  for (const o of local) map[o.shelf_id] = { ...o };
  // ERP takes priority
  for (const o of erp) map[o.shelf_id] = { ...o };
  return Object.values(map);
}

// ---------------------------------------------------------------------------
// StatBox sub-component
// ---------------------------------------------------------------------------
function StatBox({ value, label, icon, warn }: {
  value: string | number;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  warn?: boolean;
}) {
  return (
    <View style={styles.statBox}>
      <Ionicons name={icon} size={16} color={warn ? '#DC2626' : colors.textMuted} />
      <Text style={[styles.statValue, warn && { color: '#DC2626' }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  sourcePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginTop: 4,
  },
  pillLive: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  pillLocal: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  sourcePillText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs },
  pillTextLive: { color: '#16A34A' },
  pillTextLocal: { color: '#D97706' },

  statsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 2,
    ...shadow.sm,
  },
  statValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
  },

  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadow.sm,
    marginBottom: spacing.lg,
  },
  emptyText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.md,
    gap: spacing.xl,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 12, height: 12, borderRadius: 3, marginRight: spacing.xs },
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
    maxHeight: '72%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  modalShelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalShelfId: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
  },
  modalLocation: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalCloseButton: { padding: spacing.sm },
  modalSectionTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  modalEmpty: { padding: spacing.xl, alignItems: 'center' },
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
  itemMain: { flex: 1 },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemBucket: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  ageBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  ageBadgeWarn: { backgroundColor: '#FEE2E2' },
  ageText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: colors.textMuted,
  },
  ageTextWarn: { color: '#DC2626' },
  itemDetails: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  itemDetail: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  itemSubline: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
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
