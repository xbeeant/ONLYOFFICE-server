import sys
import subprocess
import ctypes 
import os 

def is_admin():
  try:
    return ctypes.windll.shell32.IsUserAnAdmin()
  except:
    return False

def check_nodejs_version():
  nodejs_version = run_command('node -v')
  if nodejs_version == '':
    return nodejs_version
   
  nodejs_cur_version = int(nodejs_version.split('.')[0][1:])
  return nodejs_cur_version
  
def check_java_bitness():
  java_version = run_command('java -version')
  if java_version == '':
    return java_version
  elif java_version.find('64-Bit') == -1:
    return 'x32'
  elif java_version.find('32-Bit') == -1:
    return 'x64'
    
def check_rabbitmq():
  return run_command('sc query RabbitMQ')

def get_erlangPath():
  pythonV = run_command('python --version').split('Python ')[1].split('.')[0]
  if int(pythonV) > 2:
    import winreg
  else:
    import _winreg as winreg
    
  Path = ""
  try:
    keyValue = r"SOFTWARE\WOW6432Node\Ericsson\Erlang"
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if asubkey_name.split(".")[0].isdigit():
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Path = winreg.QueryValueEx(asubkey, None)[0]
      else:
        continue
    return Path
  except:
    return Path
    
def check_erlang():
  erlangPath = get_erlangPath()
  
  if erlangPath == "":
    return None
  else:
    return run_command('cd ' + erlangPath + '/bin && erl -eval "erlang:display(erlang:system_info(wordsize)), halt()."  -noshell')
  
def check_gruntcli():
  result = run_command('npm list -g --depth=0')
  
  if result.find('grunt-cli') == -1:
    return False
  else:
    return True
    
def run_command(sCommand):
  popen = subprocess.Popen(sCommand, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True) 
  result = ''
  try:
    stdout, stderr = popen.communicate()
    popen.wait()
    if sCommand == 'node -v':
      result = stdout.strip().decode("utf-8") 
    else:
      result = stdout.strip().decode("utf-8") + stderr.strip().decode("utf-8")
  finally:
    popen.stdout.close()
    popen.stderr.close()
  
  return result
