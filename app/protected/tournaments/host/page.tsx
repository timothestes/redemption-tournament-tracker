"use client";

import { useState, useEffect } from "react";
import { Toast } from "flowbite-react";
import { HiCheck } from "react-icons/hi";
import Modal from "../../../../components/ui/modal";
import { createClient } from "../../../../utils/supabase/client";
import { useRouter } from "next/navigation";
import SideNav from "../../../../components/side-nav";
import { generateCode } from "../../../../utils/generateCode";

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
      router.push("/protected/tournaments");
    }
  };

  return (
    <div className="p-4">
      <SideNav />
      <h1 className="text-2xl font-bold">Host a Tournament</h1>
      <div className="mt-4">
        <input
          type="text"
          value={newTournament}
          onChange={(e) => setNewTournament(e.target.value)}
          placeholder="New Tournament Name"
          className="border text-black p-2"
          required
          maxLength={30}
        />
        <button
          onClick={addTournament}
          className="ml-2 p-2 bg-blue-600 text-white"
        >
          Add Tournament
        </button>
      </div>
      <Modal
        isOpen={showError}
        onClose={() => setShowError(false)}
        title="Error"
      >
        <p>Tournament name is required.</p>
      </Modal>
      {showToast && (
        <div className="fixed bottom-4 right-4">
          <Toast>
            <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-500 dark:bg-green-800 dark:text-green-200">
              <HiCheck className="h-5 w-5" />
            </div>
            <div className="ml-3 text-sm font-normal">
              Tournament created successfully!
            </div>
            <Toast.Toggle />
          </Toast>
        </div>
      )}
    </div>
  );
}
