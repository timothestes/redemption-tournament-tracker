import dynamic from "next/dynamic";

const StateMap = dynamic(() => import("./StateMap"), {
  ssr: false,
  loading: () => null,
});

export default StateMap;
