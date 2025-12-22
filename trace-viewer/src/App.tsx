import { type Component, createSignal } from 'solid-js';

const App: Component = () => {
  const [count, setCount] = createSignal(0);

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-100">
      <button
        type="button"
        onClick={() => setCount(count() + 1)}
        class="text-6xl font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer bg-white px-16 py-12 rounded-lg shadow-lg hover:shadow-xl"
      >
        {count()}
      </button>
    </div>
  );
};

export default App;
