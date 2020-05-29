// Temporary text area hack: https://stackoverflow.com/a/46822033/5323344
const copySnippet = (clickEvent) => {
  const copySnippetButton = clickEvent.target;
  const tempTextArea = document.createElement('textarea');
  tempTextArea.textContent = atob(copySnippetButton.getAttribute('data-snippet'));
  document.body.appendChild(tempTextArea);

  const selection = document.getSelection();
  selection.removeAllRanges();
  tempTextArea.select();
  document.execCommand('copy');
  selection.removeAllRanges();
  document.body.removeChild(tempTextArea);

  copySnippetButton.classList.add('copied');
  setTimeout(() => {
    copySnippetButton.classList.remove('copied');
  }, 1000);
};

document.querySelectorAll('.snippet-action-copy').forEach((copySnippetButton) => {
  copySnippetButton.addEventListener('click', copySnippet);
});
