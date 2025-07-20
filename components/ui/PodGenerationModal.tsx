"use client";

import { Modal, Label, Select, Button } from "flowbite-react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";

interface PodGenerationModalProps {
  show: boolean;
  participants: any[];
  onClose: () => void;
}

export default function PodGenerationModal({ show, participants, onClose }: PodGenerationModalProps) {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [podSize, setPodSize] = useState(4);
  const [pods, setPods] = useState<any[][]>([]);

  useEffect(() => {
    // initialize default pod size when opened, cap at 8
    if (show) {
      const maxSize = Math.min(participants.length, 8);
      setPodSize(Math.min(4, maxSize));
      setPods([]);
    }
  }, [show, participants.length]);
  
  // avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);
  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) : 'dark';
  const isLightTheme = currentTheme === 'light';

  const handleGenerate = () => {
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const total = shuffled.length;
    const S = podSize;
    const fullPods = Math.floor(total / S);
    const remainder = total - fullPods * S;
    const podsArr: any[][] = [];
    // create full pods
    let index = 0;
    for (let i = 0; i < fullPods; i++) {
      podsArr.push(shuffled.slice(index, index + S));
      index += S;
    }
    // handle remainders
    if (remainder > 0) {
      const leftovers = shuffled.slice(index);
      if (fullPods > 1) {
        // distribute leftovers evenly among full pods
        leftovers.forEach((player, idx) => {
          podsArr[idx % podsArr.length].push(player);
        });
      } else {
        // single full pod or none: create separate pod of leftovers
        podsArr.push(leftovers);
      }
    }
    setPods(podsArr);
  };

  if (!show) return null;

  if (!show) return null;
  return (
    <Modal show={show} onClose={onClose} size="lg">
      <Modal.Header className={`border-b ${isLightTheme ? 'border-gray-200 bg-white' : 'border-gray-600 bg-gray-800'}`}>
        Generate Booster Draft Pods
      </Modal.Header>
      <Modal.Body className={`${isLightTheme ? 'bg-gray-50' : 'bg-gray-800'} space-y-4 p-6`}>
        <div className="text-sm text-gray-400">Participants: {participants.length}</div>
        <div>
          <Label htmlFor="pod-size">Pod Size</Label>
          <Select
            id="pod-size"
            value={podSize.toString()}
            onChange={(e) => setPodSize(Number(e.target.value))}
          >
            {Array.from({ length: Math.min(participants.length, 8) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </Select>
        </div>
        {pods.length > 0 && (
          <div className="space-y-2">
            {pods.map((group, i) => (
              <div key={i} className="border p-2 rounded">
                <h5 className="font-semibold">Pod {i + 1}</h5>
                <ul className="list-disc list-inside">
                  {group.map((p) => (
                    <li key={p.id || p.name}>{p.name}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" outline gradientDuoTone="greenToBlue" onClick={handleGenerate}>
          Generate Pods
        </Button>
        <Button
          type="button"
          outline
          gradientDuoTone="pinkToOrange"
          onClick={onClose}
          className="border-red-500 hover:bg-red-500/10"
        >
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
