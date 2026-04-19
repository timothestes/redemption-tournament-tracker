export type Message =
  | { success: string }
  | { error: string }
  | { message: string };

export function FormMessage({ message }: { message?: Message }) {
  if (!message) return null;

  return (
    <div className="flex flex-col gap-2 w-full max-w-md text-sm mt-4">
      {"success" in message && (
        <div className="text-primary border-l-2 border-primary px-4 py-3 bg-primary/10 rounded-r">
          {message.success}
        </div>
      )}
      {"error" in message && (
        <div className="text-destructive border-l-2 border-destructive px-4 py-3 bg-destructive/10 rounded-r">
          {message.error}
        </div>
      )}
      {"message" in message && (
        <div className="text-accent border-l-2 border-accent px-4 py-3 bg-accent/10 rounded-r">
          {message.message}
        </div>
      )}
    </div>
  );
}
