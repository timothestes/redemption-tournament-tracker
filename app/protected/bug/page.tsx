export default function BugPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Report a Bug</h1>
      <p className="mt-4">
        Found a bug? Send a screenshot of it to BaboonyTim on the Redemption Discord or file an issue for the tournament tracker's GitHub{" "}
        <a
          href="https://github.com/timothestes/redemption-tournament-tracker/issues"
          className="text-blue-500 underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          here
        </a>.
      </p>
    </div>
  );
}
