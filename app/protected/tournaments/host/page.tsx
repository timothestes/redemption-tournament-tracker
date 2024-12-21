"use client";

import { useState, useEffect } from "react";
import { Toast } from "flowbite-react";
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
      const timer = setTimeout(() => setShowToast(false), 3000);
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
        <div className="fixed bottom-4 left-4">
          <Toast>
            <Toast.Body className="bg-green-500 text-white">
              Tournament created successfully!
            </Toast.Body>
          </Toast>
        </div>
      )}
    </div>
  );
}
