import type { AppData, Category, Budget, BudgetGroup, Transaction, SavingsBucket, SavingsEntry, SavingsSchedule, SplitTemplate } from './db';

/** Income category names (shown in separate section, excluded from expense remaining). */
export const INCOME_CATEGORY_NAMES = new Set(['Salary']);

/** Default budget groups for new files. */
export const DEFAULT_BUDGET_GROUPS: { name: string; sortOrder: number }[] = [
  { name: 'High Variable',              sortOrder: 0 },
  { name: 'Low Variable',               sortOrder: 1 },
  { name: 'Fixed Bills',                sortOrder: 2 },
  { name: 'Subscriptions',              sortOrder: 3 },
  { name: 'Joint Utilities',            sortOrder: 4 },
  { name: 'Short Term Savings Account', sortOrder: 5 },
  { name: 'Long Term Savings',          sortOrder: 6 },
  { name: 'Occasional',                 sortOrder: 7 },
];

/** Default categories and budget amounts for new files. */
export const DEFAULT_BUDGET_ITEMS: { name: string; group: string | null; amount: number }[] = [
  { name: 'Groceries',        group: 'High Variable',              amount: 0 },
  { name: 'Home Improvement', group: 'High Variable',              amount: 0 },
  { name: 'Household Items',  group: 'High Variable',              amount: 0 },
  { name: 'Drugstore etc.',   group: 'High Variable',              amount: 0 },
  { name: 'Family Spending',  group: 'High Variable',              amount: 0 },
  { name: 'Gas',              group: 'Low Variable',               amount: 0 },
  { name: 'Charity',          group: 'Fixed Bills',                amount: 0 },
  { name: 'Media',            group: 'Fixed Bills',                amount: 0 },
  { name: 'Mortgage',         group: 'Fixed Bills',                amount: 0 },
  { name: 'Phones',           group: 'Fixed Bills',                amount: 0 },
  { name: 'Streaming',        group: 'Subscriptions',              amount: 0 },
  { name: 'Hydro',            group: 'Joint Utilities',            amount: 0 },
  { name: 'Internet',         group: 'Joint Utilities',            amount: 0 },
  { name: 'Utilities Savings',group: 'Joint Utilities',            amount: 0 },
  { name: 'Short Term Savings',group: 'Short Term Savings Account',amount: 0 },
  { name: 'RRSP',             group: 'Long Term Savings',          amount: 0 },
  { name: 'Misc.',            group: 'Occasional',                 amount: 0 },
  { name: 'Incidentals',      group: 'Occasional',                 amount: 0 },
  { name: 'Salary',           group: null,                         amount: 0 },
];

/** Default savings buckets with monthly contribution schedules. */
export const DEFAULT_SAVINGS: { bucket: string; amount: number }[] = [];

/** Current balances for each savings bucket (opening balances for new files). */
export const DEFAULT_SAVINGS_BALANCES: { bucket: string; amount: number }[] = [];

export const DEFAULT_SPLIT_TEMPLATES: Omit<SplitTemplate, 'id'>[] = [];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildDemoData(): AppData {
  const [cy, cm] = currentMonth().split('-').map(Number);

  function mStr(offset: number): string {
    let m = cm + offset;
    let y = cy;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  const m2 = mStr(-2);
  const m1 = mStr(-1);
  const m0 = currentMonth();

  let nextId = 1;

  const DEMO_ITEMS: { name: string; group: string | null; amount: number }[] = [
    { name: 'Groceries',          group: 'High Variable',              amount: 700 },
    { name: 'Home Improvement',   group: 'High Variable',              amount: 200 },
    { name: 'Household Items',    group: 'High Variable',              amount: 120 },
    { name: 'Drugstore etc.',     group: 'High Variable',              amount: 80 },
    { name: 'Family Spending',    group: 'High Variable',              amount: 200 },
    { name: 'Gas',                group: 'Low Variable',               amount: 180 },
    { name: 'Charity',            group: 'Fixed Bills',                amount: 50 },
    { name: 'Media',              group: 'Fixed Bills',                amount: 30 },
    { name: 'Mortgage',           group: 'Fixed Bills',                amount: 1850 },
    { name: 'Phones',             group: 'Fixed Bills',                amount: 120 },
    { name: 'Streaming',          group: 'Subscriptions',              amount: 35 },
    { name: 'Hydro',              group: 'Joint Utilities',            amount: 130 },
    { name: 'Internet',           group: 'Joint Utilities',            amount: 75 },
    { name: 'Utilities Savings',  group: 'Joint Utilities',            amount: 100 },
    { name: 'Short Term Savings', group: 'Short Term Savings Account', amount: 300 },
    { name: 'RRSP',               group: 'Long Term Savings',          amount: 400 },
    { name: 'Misc.',              group: 'Occasional',                 amount: 100 },
    { name: 'Incidentals',        group: 'Occasional',                 amount: 80 },
    { name: 'Salary',             group: null,                         amount: 5500 },
  ];

  const categories: Category[] = DEMO_ITEMS.map(({ name }) => ({
    id: nextId++,
    name,
    isIncome: INCOME_CATEGORY_NAMES.has(name),
  }));

  const catByName = new Map(categories.map((c) => [c.name, c.id]));

  const budgetGroups: BudgetGroup[] = DEFAULT_BUDGET_GROUPS.map(({ name, sortOrder }) => ({
    id: nextId++,
    name,
    sortOrder,
  }));
  const groupIdByName = new Map(budgetGroups.map((g) => [g.name, g.id]));

  const budgets: Budget[] = [];
  for (const mo of [m2, m1, m0]) {
    for (const { name, amount, group } of DEMO_ITEMS) {
      const categoryId = catByName.get(name)!;
      const groupId = group != null ? (groupIdByName.get(group) ?? null) : null;
      budgets.push({ id: nextId++, month: mo, categoryId, targetAmount: amount, groupId });
    }
  }

  const c = (name: string) => catByName.get(name)!;

  function txn(
    month: string, day: number, descriptor: string, amount: number, catName: string,
    opts: { ignoreInBudget?: boolean; instrument?: string } = {},
  ): Transaction {
    return {
      id: nextId++,
      txnDate: `${month}-${String(day).padStart(2, '0')}`,
      descriptor,
      amount,
      categoryId: c(catName),
      instrument: opts.instrument ?? 'Card',
      source: 'demo',
      sourceRef: '',
      linkedTransactionId: null,
      ignoreInBudget: opts.ignoreInBudget ?? false,
      comment: null,
    };
  }

  const chq = { instrument: 'Chequing' };
  const inc = { ignoreInBudget: true as const, instrument: 'Chequing' };

  const transactions: Transaction[] = [
    // ── 2 months ago ──
    txn(m2,  1, 'MORTGAGE PAYMENT',              1850, 'Mortgage',          chq),
    txn(m2,  1, 'SAVINGS TRANSFER',               300, 'Short Term Savings', chq),
    txn(m2,  1, 'RRSP CONTRIBUTION',              400, 'RRSP',               chq),
    txn(m2,  2, 'BELL INTERNET',                   75, 'Internet'),
    txn(m2,  2, 'ROGERS WIRELESS',                120, 'Phones'),
    txn(m2,  3, 'NETFLIX.COM',                     18, 'Streaming'),
    txn(m2,  3, 'SPOTIFY',                         17, 'Streaming'),
    txn(m2,  4, 'LOBLAWS #1051',                   89, 'Groceries'),
    txn(m2,  5, 'HYDRO ONE',                      124, 'Hydro'),
    txn(m2,  7, 'CANADIAN RED CROSS',              50, 'Charity'),
    txn(m2,  8, 'PETRO CANADA',                    68, 'Gas'),
    txn(m2, 10, 'LOBLAWS #1051',                   94, 'Groceries'),
    txn(m2, 11, 'COSTCO WHOLESALE',                92, 'Household Items'),
    txn(m2, 14, 'SHOPPERS DRUG MART',              47, 'Drugstore etc.'),
    txn(m2, 15, 'PAYROLL DEPOSIT',               5500, 'Salary',             inc),
    txn(m2, 16, 'MEDIA SUBSCRIPTION',             30, 'Media'),
    txn(m2, 17, 'METRO GROCERY',                 103, 'Groceries'),
    txn(m2, 19, 'HOME DEPOT',                    135, 'Home Improvement'),
    txn(m2, 20, 'FAMILY DINNER OUT',              78, 'Family Spending'),
    txn(m2, 22, 'SHELL STATION',                  55, 'Gas'),
    txn(m2, 24, 'LOBLAWS #1051',                  85, 'Groceries'),
    txn(m2, 28, 'MISC PURCHASE',                  45, 'Misc.'),

    // ── last month ──
    txn(m1,  1, 'MORTGAGE PAYMENT',              1850, 'Mortgage',          chq),
    txn(m1,  1, 'SAVINGS TRANSFER',               300, 'Short Term Savings', chq),
    txn(m1,  1, 'RRSP CONTRIBUTION',              400, 'RRSP',               chq),
    txn(m1,  2, 'BELL INTERNET',                   75, 'Internet'),
    txn(m1,  2, 'ROGERS WIRELESS',                120, 'Phones'),
    txn(m1,  3, 'NETFLIX.COM',                     18, 'Streaming'),
    txn(m1,  3, 'SPOTIFY',                         17, 'Streaming'),
    txn(m1,  3, 'LOBLAWS #1051',                  102, 'Groceries'),
    txn(m1,  5, 'HYDRO ONE',                      118, 'Hydro'),
    txn(m1,  7, 'CANADIAN RED CROSS',              50, 'Charity'),
    txn(m1,  7, 'FAMILY RESTAURANT',               58, 'Family Spending'),
    txn(m1,  9, 'PETRO CANADA',                    72, 'Gas'),
    txn(m1, 10, 'COSTCO WHOLESALE',                88, 'Household Items'),
    txn(m1, 12, 'WALMART GROCERY',                 85, 'Groceries'),
    txn(m1, 14, 'MEDIA SUBSCRIPTION',              30, 'Media'),
    txn(m1, 15, 'SHOPPERS DRUG MART',              52, 'Drugstore etc.'),
    txn(m1, 15, 'PAYROLL DEPOSIT',               5500, 'Salary',             inc),
    txn(m1, 18, 'METRO GROCERY',                   95, 'Groceries'),
    txn(m1, 21, 'FAMILY OUTING',                   92, 'Family Spending'),
    txn(m1, 23, 'PETRO CANADA',                    61, 'Gas'),
    txn(m1, 26, 'LOBLAWS #1051',                   88, 'Groceries'),
    txn(m1, 28, 'INCIDENTALS',                     35, 'Incidentals'),

    // ── this month (partial) ──
    txn(m0,  1, 'MORTGAGE PAYMENT',              1850, 'Mortgage',          chq),
    txn(m0,  1, 'SAVINGS TRANSFER',               300, 'Short Term Savings', chq),
    txn(m0,  1, 'RRSP CONTRIBUTION',              400, 'RRSP',               chq),
    txn(m0,  2, 'BELL INTERNET',                   75, 'Internet'),
    txn(m0,  2, 'ROGERS WIRELESS',                120, 'Phones'),
    txn(m0,  3, 'NETFLIX.COM',                     18, 'Streaming'),
    txn(m0,  3, 'SPOTIFY',                         17, 'Streaming'),
    txn(m0,  4, 'LOBLAWS #1051',                   98, 'Groceries'),
    txn(m0,  5, 'HYDRO ONE',                      122, 'Hydro'),
    txn(m0,  7, 'PETRO CANADA',                    65, 'Gas'),
    txn(m0,  9, 'FAMILY COFFEE & LUNCH',            42, 'Family Spending'),
    txn(m0, 10, 'METRO GROCERY',                   87, 'Groceries'),
    txn(m0, 14, 'SHOPPERS DRUG MART',              39, 'Drugstore etc.'),
    txn(m0, 15, 'PAYROLL DEPOSIT',               5500, 'Salary',             inc),
    txn(m0, 16, 'MEDIA SUBSCRIPTION',             30, 'Media'),
  ];

  // Savings buckets
  const emergencyId = nextId++;
  const vacationId  = nextId++;

  const savingsBuckets: SavingsBucket[] = [
    { id: emergencyId, name: 'Emergency Fund' },
    { id: vacationId,  name: 'Vacation' },
  ];

  const savingsEntries: SavingsEntry[] = [
    { id: nextId++, entryDate: `${m2}-01`, bucketId: emergencyId, amount: 8000, notes: 'Opening balance', source: 'manual', scheduleId: null },
    { id: nextId++, entryDate: `${m2}-01`, bucketId: vacationId,  amount: 2400, notes: 'Opening balance', source: 'manual', scheduleId: null },
    { id: nextId++, entryDate: `${m1}-01`, bucketId: emergencyId, amount: 300,  notes: 'Monthly contribution', source: 'manual', scheduleId: null },
    { id: nextId++, entryDate: `${m1}-01`, bucketId: vacationId,  amount: 200,  notes: 'Monthly contribution', source: 'manual', scheduleId: null },
    { id: nextId++, entryDate: `${m0}-01`, bucketId: emergencyId, amount: 300,  notes: 'Monthly contribution', source: 'manual', scheduleId: null },
    { id: nextId++, entryDate: `${m0}-01`, bucketId: vacationId,  amount: 200,  notes: 'Monthly contribution', source: 'manual', scheduleId: null },
  ];

  const savingsSchedules: SavingsSchedule[] = [
    { id: nextId++, bucketId: emergencyId, dayOfMonth: 1, amount: 300, startMonth: nextMonth(), active: true },
    { id: nextId++, bucketId: vacationId,  dayOfMonth: 1, amount: 200, startMonth: nextMonth(), active: true },
  ];

  return {
    nextId,
    categories,
    categoryRules: [],
    budgetGroups,
    budgets,
    transactions,
    transactionSplits: [],
    savingsBuckets,
    savingsEntries,
    savingsSchedules,
    recurringTemplates: [],
    splitTemplates: [],
    experimentalBudgets: [],
  };
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

  const budgetGroups: BudgetGroup[] = DEFAULT_BUDGET_GROUPS.map(({ name, sortOrder }) => ({
    id: nextId++,
    name,
    sortOrder,
  }));
  const groupIdByName = new Map(budgetGroups.map((g) => [g.name, g.id]));

  const budgetMonths = [month];
  const budgets: Budget[] = [];
  for (const m of budgetMonths) {
    for (const { name, amount, group } of DEFAULT_BUDGET_ITEMS) {
      const categoryId = catByName.get(name)!;
      const groupId = group != null ? (groupIdByName.get(group) ?? null) : null;
      budgets.push({ id: nextId++, month: m, categoryId, targetAmount: amount, groupId });
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
