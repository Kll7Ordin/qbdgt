import type { AppData, Category, Budget, BudgetGroup, SavingsBucket, SavingsEntry, SavingsSchedule, SplitTemplate } from './db';

/** Income category names (shown in separate section, excluded from expense remaining). */
export const INCOME_CATEGORY_NAMES = new Set(['Salary', 'Partner Transfer', 'Child Benefit']);

/** Default categories and budget amounts for new files. */
export const DEFAULT_BUDGET_ITEMS: { name: string; amount: number }[] = [
  { name: 'Household Items', amount: 100 },
  { name: 'Home Improvement', amount: 150 },
  { name: 'Joint Spending', amount: 200 },
  { name: 'Family Spending', amount: 100 },
  { name: 'Alcohol', amount: 100 },
  { name: 'Groceries', amount: 1300 },
  { name: 'Drugstore etc.', amount: 100 },
  { name: 'Kids Activities', amount: 150 },
  { name: 'Kids Clothes', amount: 200 },
  { name: 'Kids Misc. Things', amount: 200 },
  { name: 'Gas', amount: 160 },
  { name: 'Partner Spending', amount: 250 },
  { name: 'Personal Spending', amount: 250 },
  { name: 'Healthcare Incidentals', amount: 50 },
  { name: 'Misc. Incidentals', amount: 100 },
  { name: 'Charity', amount: 40 },
  { name: 'Haircut 1', amount: 27 },
  { name: 'Haircut 2', amount: 27 },
  { name: 'Noah Haircut', amount: 20 },
  { name: 'Daycare', amount: 501 },
  { name: 'Netflix', amount: 0 },
  { name: 'Disney', amount: 0 },
  { name: 'ChatGPT', amount: 30 },
  { name: 'Streaming', amount: 45 },
  { name: 'Media', amount: 46 },
  { name: 'Car Insurance - Supplimentary', amount: 53.32 },
  { name: 'Spotify', amount: 17.91 },
  { name: 'Amazon Prime', amount: 0 },
  { name: 'Commonwealth Membership', amount: 30 },
  { name: 'Mortgage', amount: 2280.38 },
  { name: 'Phones', amount: 80 },
  { name: 'Misc.', amount: 0 },
  { name: 'Window Loan Repayment', amount: 151.61 },
  { name: 'Partner Work', amount: 50 },
  { name: 'Partner School', amount: 350 },
  { name: 'RRSP 1', amount: 650 },
  { name: 'RRSP 2', amount: 350 },
  { name: 'Salary', amount: 7287.42 },
  { name: 'Partner Transfer', amount: 4600 },
  { name: 'Child Benefit', amount: 348.85 },
  { name: 'Synagogue Membership', amount: 220 },
  { name: 'Partner School Savings', amount: 450 },
  { name: 'Mortgage Extra', amount: 450 },
  { name: 'Short Term Savings', amount: 500 },
  { name: 'Vacation Savings', amount: 500 },
  { name: 'House Incidentals Savings', amount: 100 },
  { name: 'Partner Tax', amount: 1000 },
  { name: 'New Car Savings', amount: 100 },
  { name: 'Car Incidentals Savings', amount: 150 },
  { name: 'Car Insurance Savings', amount: 91.5 },
  { name: 'Property Tax Savings', amount: 266 },
  { name: 'House Insurance Savings', amount: 99 },
  { name: 'Misc. Short Term Savings', amount: 100 },
  { name: 'Hydro', amount: 165.2 },
  { name: 'Internet', amount: 75.6 },
  { name: 'Utilities Savings', amount: 70 },
  { name: 'Spotify Kathy', amount: -10 },
  { name: 'Noah Savings', amount: 200 },
  { name: 'Mira Savings', amount: 200 },
  { name: 'Vacation', amount: 0 },
  { name: 'House Incidentals', amount: 0 },
  { name: 'Car Incidentals', amount: 0 },
  { name: 'Car Insurance', amount: 0 },
  { name: 'Property Tax', amount: 0 },
  { name: 'House Insurance', amount: 0 },
  { name: 'Short Term Savings Spending', amount: 0 },
];

/** Default savings buckets with monthly contribution schedules. */
export const DEFAULT_SAVINGS: { bucket: string; amount: number }[] = [
  { bucket: 'Short Term Savings', amount: 500 },
  { bucket: 'Vacation Savings', amount: 500 },
  { bucket: 'House Incidentals Savings', amount: 100 },
  { bucket: 'Partner Tax', amount: 1000 },
  { bucket: 'New Car Savings', amount: 100 },
  { bucket: 'Car Incidentals Savings', amount: 150 },
  { bucket: 'Car Insurance Savings', amount: 91.5 },
  { bucket: 'Property Tax Savings', amount: 266 },
  { bucket: 'House Insurance Savings', amount: 99 },
  { bucket: 'Misc. Short Term Savings', amount: 100 },
];

/** Current balances for each savings bucket (opening balances for new files). Total: 14833.23 */
export const DEFAULT_SAVINGS_BALANCES: { bucket: string; amount: number }[] = [
  { bucket: 'Car Insurance Savings', amount: 1281 },
  { bucket: 'House Incidentals Savings', amount: 1531 },
  { bucket: 'Car Incidentals Savings', amount: 910 },
  { bucket: 'Vacation Savings', amount: 3809.7 },
  { bucket: 'House Insurance Savings', amount: 397.62 },
  { bucket: 'Property Tax Savings', amount: 1038 },
  { bucket: 'New Car Savings', amount: 1500 },
  { bucket: 'Partner Tax', amount: 10000 },
  { bucket: 'Misc. Short Term Savings', amount: 1200 },
  { bucket: 'Short Term Savings', amount: 1165.91 },
];

export const DEFAULT_SPLIT_TEMPLATES: Omit<SplitTemplate, 'id'>[] = [
  {
    name: 'Savings transfer',
    items: [
      { categoryName: 'Short Term Savings', amount: 500 },
      { categoryName: 'Vacation Savings', amount: 500 },
      { categoryName: 'House Incidentals Savings', amount: 100 },
      { categoryName: 'Partner Tax', amount: 1000 },
      { categoryName: 'New Car Savings', amount: 100 },
      { categoryName: 'Car Incidentals Savings', amount: 150 },
      { categoryName: 'Car Insurance Savings', amount: 91.5 },
      { categoryName: 'Property Tax Savings', amount: 266 },
      { categoryName: 'House Insurance Savings', amount: 99 },
      { categoryName: 'Misc. Short Term Savings', amount: 100 },
    ],
  },
  {
    name: 'Utilities transfer',
    items: [
      { categoryName: 'Hydro', amount: 165.2 },
      { categoryName: 'Internet', amount: 75.6 },
      { categoryName: 'Utilities Savings', amount: 70 },
      { categoryName: 'Spotify Kathy', amount: -10 },
    ],
  },
];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildSeedData(): AppData {
  const month = currentMonth();
  let nextId = 1;

  const categories: Category[] = DEFAULT_BUDGET_ITEMS.map(({ name }) => ({
    id: nextId++,
    name,
    isIncome: INCOME_CATEGORY_NAMES.has(name),
  }));

  const catByName = new Map(categories.map((c) => [c.name, c.id]));

  const budgetGroups: BudgetGroup[] = [];
  const budgetMonths = [month, '2026-01', '2026-02', '2026-03'];
  const budgets: Budget[] = [];
  for (const m of budgetMonths) {
    for (const { name, amount } of DEFAULT_BUDGET_ITEMS) {
      const categoryId = catByName.get(name)!;
      budgets.push({ id: nextId++, month: m, categoryId, targetAmount: amount });
    }
  }

  const savingsBuckets: SavingsBucket[] = [];
  const savingsSchedules: SavingsSchedule[] = [];
  const savingsEntries: SavingsEntry[] = [];
  const bucketIdByName = new Map<string, number>();

  for (const { bucket, amount } of DEFAULT_SAVINGS) {
    const bucketId = nextId++;
    savingsBuckets.push({ id: bucketId, name: bucket });
    bucketIdByName.set(bucket, bucketId);
    savingsSchedules.push({
      id: nextId++,
      bucketId,
      dayOfMonth: 1,
      amount,
      startMonth: nextMonth(),
      active: true,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const { bucket, amount } of DEFAULT_SAVINGS_BALANCES) {
    const bucketId = bucketIdByName.get(bucket);
    if (bucketId != null && amount !== 0) {
      savingsEntries.push({
        id: nextId++,
        entryDate: today,
        bucketId,
        amount,
        notes: 'Opening balance (first schedule contribution is next month)',
        source: 'manual',
        scheduleId: null,
      });
    }
  }

  const splitTemplates: SplitTemplate[] = DEFAULT_SPLIT_TEMPLATES.map((t) => ({
    id: nextId++,
    name: t.name,
    items: t.items,
  }));

  return {
    nextId,
    categories,
    categoryRules: [],
    budgetGroups,
    budgets,
    transactions: [],
    transactionSplits: [],
    savingsBuckets,
    savingsEntries,
    savingsSchedules,
    recurringTemplates: [],
    splitTemplates,
  };
}
