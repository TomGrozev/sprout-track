export const upgradeModalStyles = {
  body: 'space-y-4',
  choiceGrid: 'space-y-3',
  choiceCard:
    'flex w-full flex-col gap-1 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50',
  choiceCardTitle: 'text-sm font-semibold text-gray-900',
  choiceCardDesc: 'text-xs text-gray-500',
  balanceRow: 'flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2',
  balanceLabel: 'text-sm text-gray-500',
  balanceValue: 'text-sm font-semibold text-gray-900',
  row: 'space-y-2 rounded-xl border border-gray-200 p-3',
  rowHeader: 'flex items-center justify-between',
  rowLabel: 'text-xs font-medium text-gray-500',
  twoCol: 'grid grid-cols-2 gap-2',
  fieldLabel: 'text-xs font-medium text-gray-600',
  readout: 'flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2',
  readoutValue: 'text-sm font-semibold text-gray-900',
  warn: 'text-sm font-medium text-red-600',
} as const;
