import { bobe, Store } from 'bobe';
import './style.css';
import { message } from './message';

export default class LocalFolderApp extends Store {
  count = 1;

  increment = () => {
    this.count += 1;
    console.log(message, this.count);
  };

  ui = bobe`
    div class="local-folder-demo"
      h1 children="Local folder fixture"
      p children={message}
      p children={"Count: " + count}
      button onclick={increment} children="Increment"
  `;
}
