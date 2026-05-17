import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/")({
  component: () => {
    const nav = useNavigate();
    useEffect(() => { nav({ to: "/inbox" }); }, [nav]);
    return null;
  },
});
