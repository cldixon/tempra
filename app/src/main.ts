import { mount } from "svelte";
import App from "./App.svelte";
import { readBoot } from "./boot";
import { interceptLinks } from "./router";

interceptLinks();
// The first page's API answers, carried in the shell (TEMPRA-175), before anything asks for them.
readBoot();

mount(App, { target: document.getElementById("root") as HTMLElement });
