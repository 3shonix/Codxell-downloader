import dynamic from "next/dynamic";

const CustomVideoPlayer = dynamic(() => import("./CustomVideoPlayer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] flex items-center justify-center bg-black/80 text-white">
      Loading video…
    </div>
  ),
});

export default CustomVideoPlayer;
