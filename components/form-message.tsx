export type Message =
  | { success: string }
  | { error: string }
  | { message: string };

export function FormMessage({ message }: { message?: Message }) {
  if (!message) return null;
  
  return (
    <div className="flex flex-col gap-2 w-full max-w-md text-sm">
      {"success" in message && (
        <div className="text-green-700 dark:text-green-400 border-l-2 border-green-500 dark:border-green-400 px-4 py-2 bg-green-50 dark:bg-green-900/20 rounded-r">
          {message.success}
        </div>
      )}
      {"error" in message && (
        <div className="text-red-700 dark:text-red-400 border-l-2 border-red-500 dark:border-red-400 px-4 py-2 bg-red-50 dark:bg-red-900/20 rounded-r">
          {message.error}
        </div>
      )}
      {"message" in message && (
        <div className="text-blue-700 dark:text-blue-400 border-l-2 border-blue-500 dark:border-blue-400 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-r">
          {message.message}
        </div>
      )}
    </div>
  );
}
