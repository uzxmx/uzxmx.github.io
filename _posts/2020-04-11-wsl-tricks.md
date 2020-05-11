---
title: WSL tricks
date: 2020-04-11 19:37:24 +0800
categories: wsl
---

This post shares some WSL (Windows Subsystem for Linux) tricks. The Windows
Subsystem for Linux lets developers run a GNU/Linux environment -- including
most command-line tools, utilities, and applications -- directly on Windows,
unmodified, without the overhead of a virtual machine.

**Tip:** If you haven't heard of WSL, you can find more information
[here](https://docs.microsoft.com/en-us/windows/wsl/about).
{: .notice--info}

When I installed WSL Ubuntu, and setup the development environment using my
[dotfiles][dotfiles], I encountered some issues and inconveniences, such as:

* New directory is created wrongly with 777 permission.
* Directory shows ugly green background.
* Need to input passphrase for my private key every time I ssh into a machine.
* Cannot open directory from WSL.
* ...

Below I list solutions for each of those issues.

### Wrong 777 permission

Basically, there are two kinds of 777 permission issues. They are:

* The mounted directories from Windows system (like files in C drive) having 777
  permission.
* Newly created directories on WSL having 777 permission.

#### For mounted directories from Windows system

On WSL, add below contents to `/etc/wsl.conf`, if that file doesn't exist,
create a new one. You may need to restart WSL or Windows system in order to make
the settings alive.

```ini
[automount]
options = "metadata,umask=022"
```

**Tip:** For more information about WSL settings, please visit
[here](https://docs.microsoft.com/en-us/windows/wsl/wsl-config#set-wsl-launch-settings)
{: .notice--info}

#### For newly created directories

When you create a new file in an interactive shell, the file permission is given
according to mask value. You  can check that value by running `umask` in your
shell. If the value is `0000`, then it means the newly created directory will be
given 777 permission (rwxrwxrwx).

There are two solutions for this issue.

The first solution is adding below contents to your `~/.bashrc` or `~/.zshrc`.

```sh
umask 002
```

The second solution is to ask `wsl.exe` to launch a login shell through
`/bin/login`. Run below command in `cmd.exe` or `powershell.exe` or your
favorite terminal, change the username to your own:

```sh
wsl.exe -u root -- /bin/login -f username
```

**Note:** The side-effect is that specific paths will be removed from PATH
environment variable.
{: .notice--warning}

### Windows executables PATHs are missing

If you use the second solution from [here](#for-newly-created-directories), or
for some reason, you find some Windows executables PATHs are missing from WSL
shell's PATH environment variable. You can use below way to append Windows paths
to PATH environment variable, so that you can call your favorite Windows
executables from WSL.

Add below contents to your `~/.bashrc` or `~/.zshrc`:

```sh
if [[ "$(uname -r)" =~ Microsoft$ ]]; then
  _path="$(/mnt/c/Windows/System32/cmd.exe /c "echo %PATH%" | tr ";" "\n" | sed -Ee 's/^([C-Z]):/\/mnt\/\l\1/' -e 's/\\/\//g' | tr "\n" ":")"
  if [[ -n "$_path" ]]; then
    PATH="$PATH:$_path"
  fi
fi
```

### Start ssh-agent automatically

If your private key is protected by a non-empty passphrase, you may need to
input the passphrase every time you push to github or ssh into a machine. To
avoid this, you can start ssh-agent once you open a terminal or start a new
interactive shell. Add below contents to your `~/.bashrc` or `~/.zshrc`:

```sh
# Share a same ssh-agent across sessions.
if [ -f ~/.ssh-agent.generated.env ]; then
  . ~/.ssh-agent.generated.env >/dev/null
  # If the $SSH_AGENT_PID is occupied by other process, we need to manually
  # remove ~/.ssh-agent.generated.env.
  if ! kill -0 $SSH_AGENT_PID &>/dev/null; then
    # Stale ssh-agent env file found. Spawn a new ssh-agent.
    eval `ssh-agent | tee ~/.ssh-agent.generated.env`
    ssh-add
  fi
else
  eval `ssh-agent | tee ~/.ssh-agent.generated.env`
  ssh-add
fi
```

### Access Windows clipboard in nvim on WSL

According to [this wiki][nvim-how-to-use-windows-clipboard], we can use
[win32yank](https://github.com/equalsraf/win32yank) to access windows clipbard
in nvim, but the steps are too many, and `win32yank.exe` must be put outside of
WSL rootfs in order to work. I only want to do a quick setup on WSL side. Here
comes the dragon.

We can use `clip.exe` that comes with Windows system to copy something to
clipbard. To get from clipbard, Windows doesn't provide such utility. We can use
`powershell.exe -command Get-Clipboard` to do that. But that costs too much time
to run on WSL. So we need a more efficient way to implement that.

Here is a [package](https://github.com/uzxmx/pasteboard) that provides two
commands `pbcopy.exe` and `pbpaste.exe`, which are much like OSX's
pbcopy/pbpaste. Install it through [scoop](https://scoop.sh/).

```sh
scoop install https://raw.githubusercontent.com/uzxmx/scoop-extras/master/bucket/pasteboard.json
```

After the installation, make sure scoop shims are in $PATH. Run `type
pbpaste.exe` to check if it's in $PATH. You may need to restart the terminal if
$PATH doesn't contain scoop shims.

Add below contents to your `~/.vimrc`:

```vim
if system('uname -r') =~ 'Microsoft'
  let g:clipboard = {
    \ 'name': 'WSLClipboard',
    \ 'copy': {
    \   '+': 'clip.exe',
    \   '*': 'clip.exe',
    \   },
    \ 'paste': {
    \   '+': 'pbpaste.exe --lf',
    \   '*': 'pbpaste.exe --lf',
    \   },
    \ 'cache_enabled': 1
    \ }
endif
```

**Tip:** For more information about `g:clipboard` in nvim, run `:h g:clipboard`.
{: .notice--info}

Reopen nvim. This time, when you press `y` to yank, the text should go to
clipboard, and when pressing `p` to paste, the content of clipboard should be
pasted.

### Open directory or URL from WSL

If you have used much CLI in OSX system, you must be familiar with `open`
command. It can open a file or directory in Finder window, also can open a web
page if the parameter is with HTTP schema. So how to do these on WSL? Here're
some examples that show how to do that.

```sh
cmd.exe /c "start explorer.exe C:\\Windows"
cmd.exe /c "start explorer.exe C:\\Users"

cmd.exe /c start "http://example.com"
```

**Note:** The directory passed to `explorer.exe` must be Windows path (not WSL
path like /mnt/c/Windows). To open a browser, the parameter must be with
`http://` or `https://` prefix.
{: .notice--warning}

For a full convenient script, you can reference the bash script
[open](https://github.com/uzxmx/dotfiles/blob/master/bin/open) which
imitates OSX's open.

### Remove ugly green background for directories

A color init string consists of one or more numeric codes, seperated by `;`. For
example:

```
OTHER_WRITABLE 34;42
EXEC 00;31
```

Below are all numeric codes:

```
Attribute codes:
00=none 01=bold 04=underscore 05=blink 07=reverse 08=concealed

Text color codes:
30=black 31=red 32=green 33=yellow 34=blue 35=magenta 36=cyan 37=white

Background color codes:
40=black 41=red 42=green 43=yellow 44=blue 45=magenta 46=cyan 47=white
```

For `OTHER_WRITABLE 34;42`, it means o+w directory has blue text and green
background. For `EXEC 00;31`, it means executable file has red text, with no
attribute and no background.

In order to update the color, we first generate default colors by executing:

```sh
dircolors -p >~/.dircolors
```

Then open `~/.dircolors`, change the color of the target type. For example,
change color of `OTHER_WRITABLE` from `34;42`  to `00;34`, the background will
be removed.

After changing any color, add below content to your `~/.bashrc` or `~/.zshrc`:

```sh
eval "$(dircolors ~/.dircolors)"
```

For Zsh user, you also need to add below content to make the color normal when
auto-completing.

```zsh
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
```

Then start a new shell. You shouldn't see ugly green background any more.

### Use vagrant

Vagrant [supports](https://www.vagrantup.com/docs/other/wsl.html#windows-access)
WSL, but some of Vagrantfile and plugins may not support it. For example, if you
use `ubuntu/bionic64` box, in `~/.vagrant.d/boxes/ubuntu-VAGRANTSLASH-bionic64/0/virtualbox`
there is a line shown below:

```rb
vb.customize [ "modifyvm", :id, "--uartmode1", "file", File.join(Dir.pwd, "ubuntu-bionic-18.04-cloudimg-console.log") ]
```

The above line will stop vagrant working on WSL. Because it sets a WSL path in
Virtualbox, but Virtualbox cannot find that path, we must convert the WSL path
to Windows path so that it can work. There is also a quick workaround
[here](https://github.com/hashicorp/vagrant/issues/8604). ~~For such reason, I
suggest not to use vagrant on WSL. Instead, use vagrant on Windows directly.~~
Because I use `centos/7` as my base box, unlike `ubuntu/bionic64` it works well
on WSL, so I still insist on using vagrant on WSL.

When using vagrant on WSL or Windows, the vagrant project should exist outside of WSL
rootfs so that virtualbox or vagrant can find the correct path.

#### Kernel panic - not syncing

If you run Vagrant Centos/7 box, you may experience an error [Kernel panic - not
syncing](https://forums.virtualbox.org/viewtopic.php?f=3&t=93990) on Virtualbox
6.0.8. A workaround is to use Virtualbox 6.0.6. I haven't tried if it works in
the latest version.

#### Agent forwarding issue

This issue only appears when using vagrant on Windows (not WSL). When we run
vagrant, it cannot find ssh agent inside WSL, so ssh agent forwarding may not
work. As a workaround, we can use ssh directly.

```sh
# This one will not work.
vagrant ssh -- -A

# This one will work. Replace the port with the correct port which will be
# shown when you run `vagrant up` or `vagrant ssh-config`. Below line
# assumes the current working directory is vagrant project root directory,
# you may need to ensure the private_key file has correct permission.
ssh vagrant@localhost -p port -i .vagrant/machines/default/virtualbox/private_key -A
```

[dotfiles]: https://github.com/uzxmx/dotfiles
[nvim-how-to-use-windows-clipboard]: https://github.com/neovim/neovim/wiki/FAQ#how-to-use-the-windows-clipboard-from-wsl
