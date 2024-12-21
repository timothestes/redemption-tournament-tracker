"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../utils/supabase/client";
import SideNav from "../../../components/side-nav";

const supabase = createClient();

export default function ProfilePage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error("Error fetching user:", error);
      } else {
        setUser(data.user);
      }
    };

    fetchUser();
  }, []);

  return (
    <div className="p-4 pl-64">
      <SideNav />
      <h1 className="text-2xl font-bold">Profile</h1>
      {user ? (
        <div className="mt-4">
          <p>Email: {user.email}</p>
          <p>Signed up: {new Date(user.created_at).toLocaleDateString()}</p>
        </div>
      ) : (
        <p>Loading user information...</p>
      )}
    </div>
  );
}
