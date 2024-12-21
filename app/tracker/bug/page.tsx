
export default function BugPage() {
  return (
    <div className="flex h-screen bg-50 pl-64">
      <div className="flex flex-col items-start justify-start flex-grow text-left p-0 space-y-4">
        <h1 className="text-3xl font-extrabold text-800">Report a Bug</h1>
        <p className="max-w-lg text-lg text-700 leading-relaxed">
          Found a bug? Let us know so we can fix it! You can send a screenshot to BaboonyTim on the {" "}
          <a
            href="https://discord.com/invite/jREJdTysPp"
            className="text-blue-600 underline font-medium hover:text-blue-800"
            target="_blank"
            rel="noopener noreferrer"
          >
            Redemption Discord
          </a>{" "}
          or file an issue on the tournament tracker's GitHub{" "}
          <a
            href="https://github.com/timothestes/redemption-tournament-tracker/issues"
            className="text-blue-600 underline font-medium hover:text-blue-800"
            target="_blank"
            rel="noopener noreferrer"
          >
            here
          </a>.
        </p>
        <div className="flex flex-row items-start space-x-4 mt-4">
          <a
            href="https://discord.com/invite/jREJdTysPp"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join Redemption Discord
          </a>
          <a
            href="https://github.com/timothestes/redemption-tournament-tracker/issues"
            className="px-6 py-3 bg-red-800 text-white rounded-lg shadow-lg hover:bg-red-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            File an Issue on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
