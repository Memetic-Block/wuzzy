import { h } from '../jsx/jsx-runtime';
import { Layout } from '../layout';

const buttonClass =
  'cursor-pointer rounded border border-gray-300 px-4 py-2 hover:bg-gray-100';

export default () => (
  <Layout title="Home">
    <h1 class="text-2xl font-bold">Repository template</h1>
    <p class="mt-2">NestJS + HTMX on Bun. Each section below talks to the backend over HTMX.</p>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Backend fragment</h2>
      <p class="mt-1 text-sm text-gray-600">Fetches an HTML fragment from the backend.</p>
      <button
        class={`mt-2 ${buttonClass}`}
        hx-get="/api/hello"
        hx-target="#greeting"
        hx-swap="innerHTML"
      >
        Greet
      </button>
      <div id="greeting" class="mt-2"></div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Database (Postgres + TypeORM)</h2>
      <p class="mt-1 text-sm text-gray-600">Add a row, then see the latest rows from the database.</p>
      <form
        class="mt-2 flex gap-2"
        hx-post="/api/examples"
        hx-target="#examples"
        hx-swap="innerHTML"
      >
        <input
          name="name"
          required
          placeholder="Row name"
          class="flex-1 rounded border border-gray-300 px-3 py-2"
        />
        <button class={buttonClass} type="submit">
          Add
        </button>
      </form>
      <div id="examples" class="mt-2" hx-get="/api/examples" hx-trigger="load"></div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold">Queue (Redis + BullMQ)</h2>
      <p class="mt-1 text-sm text-gray-600">Enqueue a job; the backend worker logs when it runs.</p>
      <button
        class={`mt-2 ${buttonClass}`}
        hx-post="/api/jobs"
        hx-target="#job-result"
        hx-swap="innerHTML"
      >
        Enqueue job
      </button>
      <div id="job-result" class="mt-2"></div>
    </section>
  </Layout>
);
