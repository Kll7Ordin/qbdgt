import { useTransactions } from './hooks/useTransactions';
import { Summary } from './components/Summary';
import { TransactionForm } from './components/TransactionForm';
import { TransactionList } from './components/TransactionList';
import './App.css';

function App() {
  const { transactions, addTransaction, deleteTransaction } = useTransactions();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Budget</h1>
      </header>
      <main>
        <Summary transactions={transactions} />
        <TransactionForm onAdd={addTransaction} />
        <section className="history">
          <h2>History</h2>
          <TransactionList transactions={transactions} onDelete={deleteTransaction} />
        </section>
      </main>
    </div>
  );
}

export default App;
