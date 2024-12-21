import { Toast } from "flowbite-react";
import { HiCheck } from "react-icons/hi";

interface ToastNotificationProps {
  message: string;
  show: boolean;
  onClose: () => void;
  type?: "success" | "error";
}

const ToastNotification: React.FC<ToastNotificationProps> = ({
  message,
  show,
  onClose,
  type = "success",
}) => {
  if (!show) return null;

  const bgColor =
    type === "success"
      ? "bg-green-100 text-green-500 dark:bg-green-800 dark:text-green-200"
      : "bg-red-100 text-red-500 dark:bg-red-800 dark:text-red-200";

  return (
    <div className="fixed bottom-4 right-4">
      <Toast>
        <div className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
          <HiCheck className="h-5 w-5" />
        </div>
        <div className="ml-3 text-sm font-normal">{message}</div>
        <Toast.Toggle onClick={onClose} />
      </Toast>
    </div>
  );
};

export default ToastNotification;
