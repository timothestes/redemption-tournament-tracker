"use client";

import { useState, useEffect } from "react";
import ToastNotification from "../../../../components/ui/toast-notification";
import Modal from "../../../../components/ui/modal";
import { createClient } from "../../../../utils/supabase/client";
import { useRouter } from "next/navigation";
import { generateCode } from "../../../../utils/generateCode";
import { Button } from "flowbite-react";
import { HiPlus } from "react-icons/hi";

const supabase = createClient();

export default function HostTournamentPage() {
  const [newTournament, setNewTournament] = useState("");
  const [showError, setShowError] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(false), 3000); // 3 seconds
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  const addTournament = async () => {
    if (!newTournament.trim()) {
      setShowError(true);
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error("Error fetching user:", userError);
      return;
    }

    const code = generateCode();
    const { data, error } = await supabase
      .from("tournaments")
      .insert([{ name: newTournament, code, host_id: user.id }])
      .select();
    if (error) console.error("Error adding tournament:", error);
    else {
      setNewTournament("");
      setShowToast(true);
      router.push("/tracker/tournaments");
    }
  };

  return (
    <div className="flex min-h-screen ">
      <div className=" p-6 rounded-lg shadow-lg max-w-md w-full text-center">
        <h1 className="text-3xl font-bold text-white mb-4">Host a Tournament</h1>
        <input
          type="text"
          value={newTournament}
          onChange={(e) => setNewTournament(e.target.value)}
          placeholder="New Tournament Name"
          className="w-full mb-4 p-3 text-lg rounded-lg border border  text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          maxLength={30}
        />
        <Button
          onClick={addTournament}
          className="w-full flex text-white"
          outline gradientDuoTone="greenToBlue"
          disabled={!newTournament.trim()}
        >
          <HiPlus className="w-6 h-6" />
          Add Tournament
        </Button>
        <Modal
          isOpen={showError}
          onClose={() => setShowError(false)}
          title="Error"
        >
          <p className="text-red-600">Tournament name is required.</p>
        </Modal>
        <ToastNotification
          message="Tournament created successfully!"
          show={showToast}
          onClose={() => setShowToast(false)}
          type="success"
        />
      </div>
    </div>
  );
}
